import {
	ChatInputCommandInteraction,
	Client,
	Collection,
	Events,
	GatewayIntentBits,
	MessageFlags,
	REST,
	RESTPostAPIChatInputApplicationCommandsJSONBody,
	Routes,
	SendableChannels,
	SlashCommandBooleanOption,
	SlashCommandBuilder,
	SlashCommandOptionsOnlyBuilder,
} from "discord.js";
import { get_status } from "./api.ts";
import "@std/dotenv/load";
import { format_date, log, LOG_TAGS } from "./logging.ts";
import { DB, Row, RowObject } from "https://deno.land/x/sqlite/mod.ts";

const CHECK_INTERVAL = 5000;

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
const db = new DB("player_data.sqlite");

// TODO: store in-game time, connection counts?, avg time/session?
//     - players talbe (names) -> sessions table (connect_time, disconnect_time) <-- can get count, avg time, total time even current
//          - pass current time if disconnect_time is null when doing sums and things
//          - after start check every record, if disconnect_time is null set last online date

db.execute(`
	create table if not exists players (
		id integer primary key autoincrement,
		name text not null unique
	) strict
`);

db.execute(`
	create table if not exists sessions (
		player_id integer not null,
		connect_time integer not null,
		disconnect_time integer,
		foreign key(player_id) references players(id)
	) strict
`);

const insert_player = db.prepareQuery<Row, RowObject, { name: string }>(
	"INSERT INTO players (name) VALUES (:name)",
);

const open_session = db.prepareQuery<Row, RowObject, { player_name: string; conn_time: number }>(
	"INSERT INTO sessions (player_id, connect_time) VALUES ((select id from players where name = :player_name), :conn_time)",
);
const close_session = db.prepareQuery<Row, RowObject, { player_name: string; disconnect_time: number }>(
	"update sessions set disconnect_time = :disconnect_time where player_id = (select id from players where name = :player_name) and disconnect_time is null",
);

const get_player = db.prepareQuery<[number, number], { time: number; count: number }, { time: number; name: string }>(
	`SELECT COUNT(sessions.player_id) as count,
	SUM((CASE WHEN sessions.disconnect_time is null then :time else sessions.disconnect_time end) - sessions.connect_time) as time
	from players join sessions on sessions.player_id = players.id
	where players.name = :name`,
);

const get_all_players = db.prepareQuery<
	[string, number, number],
	{ name: string; time: number; count: number },
	{ time: number }
>(
	`SELECT players.name as name,
	COUNT(sessions.player_id) as count,
	SUM((CASE WHEN sessions.disconnect_time is null then :time else sessions.disconnect_time end) - sessions.connect_time) as time
	from players join sessions on sessions.player_id = players.id
	group by players.id`,
);

// TODO: temporary, bot can run way after the last server shutdown
db.execute(`UPDATE sessions set disconnect_time = ${get_current_seconds()} where disconnect_time is null`);

function zip<A, B>(a: A[], b: B[]) {
	return a.map((v, i) => [v, b[i]] as [A, B]);
}

function get_current_seconds(date: Date | undefined = undefined) {
	return Math.floor((date || new Date()).getTime() / 1000);
}

function human_readable_time_diff(diff_in_s: number) {
	if (diff_in_s < 0) return diff_in_s;

	const hours = Math.floor(diff_in_s / 3600);
	diff_in_s -= 3600 * hours;

	const minutes = Math.floor(diff_in_s / 60);
	diff_in_s -= 60 * minutes;

	const seconds = Math.floor(diff_in_s);

	const out = [];
	if (hours > 0) out.push(`${hours}h`);
	if (minutes > 0) out.push(`${minutes}m`);
	if (seconds > 0) out.push(`${seconds}s`);

	return out.join(" ");
}

function clear_color_tags(tagged_name: string) {
	let name = "";
	let i = 0;

	while (i < tagged_name.length) {
		const chr = tagged_name[i];
		if (chr === "§") {
			i += 2;
			continue;
		}

		name += chr;
		i++;
	}

	return name;
}

const states = {
	is_server_up: false,
	last_players: new Map<string, number>(),
	name: "",
};

function get_channel() {
	const ch = client.channels.cache.get(Deno.env.get("MC_CHANNEL") || "");
	if (ch === undefined) {
		log(LOG_TAGS.ERROR, "Cant find channel");
		return undefined;
	}

	if (!ch.isSendable) {
		log(LOG_TAGS.ERROR, "Channel isnt sendable");
		return undefined;
	}

	return ch as SendableChannels;
}

async function check() {
	const send_ch = get_channel();
	if (!send_ch) return;

	let status = await get_status(1);

	const cur_time = new Date();
	const cur_seconds = get_current_seconds(cur_time);
	const formatted_time = format_date(cur_time);

	if (status)
		states.name = clear_color_tags(status.hostname);

	if (!states.is_server_up && status) {
		await send_ch.send(`server '${states.name}' is up (${formatted_time})!`);
		states.is_server_up = true;
	} else if (states.is_server_up && !status) {
		await send_ch.send(`server '${states.name}' is down (${formatted_time})!`);
		states.is_server_up = false;

		// INFO: fabricate own status so player left code can be reused
		status = {
			"type": 0,
			"id": 0,
			"hostname": states.name,
			"gametype": "",
			"game_id": "",
			"version": "",
			"plugins": "",
			"map": "",
			"numplayers": "0",
			"maxplayers": "",
			"hostport": "",
			"hostip": "",
			"players": [],
		};
	}

	if (!status)
		return;

	if (status.players.length === states.last_players.size && status.players.every((v) => states.last_players.has(v)))
		return;

	const cur_players = new Set(status.players);

	const players_joined = [...cur_players].filter((v) => !states.last_players.has(v));
	const players_left = [...states.last_players.keys()].filter((v) => !cur_players.has(v));

	const player_time_diff_s = players_left.map((v) => {
		const join_time = states.last_players.get(v);
		if (join_time === undefined) return -1;
		return cur_seconds - join_time;
	});

	players_left.forEach((v) => {
		states.last_players.delete(v);

		close_session.execute({ player_name: v, disconnect_time: cur_seconds });
	});

	players_joined.forEach((v) => {
		states.last_players.set(v, cur_seconds);

		const player_data = get_player.firstEntry({ name: v, time: cur_seconds });

		if (player_data === undefined || player_data.time === null) {
			insert_player.execute({ name: v });
			open_session.execute({ conn_time: cur_seconds, player_name: v });
		} else {
			open_session.execute({ conn_time: cur_seconds, player_name: v });
		}
	});

	let msg = "";

	if (players_joined.length != 0)
		msg += `**Player(s) joined** (${formatted_time}):\n- '${players_joined.join("'\n- '")}'\n`;

	if (players_left.length != 0) {
		msg += `**Player(s) left** (${formatted_time}):\n`;
		for (const [k, v] of zip(players_left, player_time_diff_s)) {
			// INFO: human_readable_time_diff can return empty string if player joined and left under a second
			msg += `- '${k}' (after ${human_readable_time_diff(v)} of gaming)\n`;
		}
	}

	if (parseInt(status.numplayers) > 0)
		msg += `**Current players**: '${cur_players.keys().toArray().join("', '")}'`;
	else
		msg += `Server is empty`;

	await send_ch.send(msg);
}

client.once(Events.ClientReady, (client) => {
	log(LOG_TAGS.INFO, `logged in as ${client.user.tag}`);

	setTimeout(async function test() {
		await check();
		setTimeout(test, CHECK_INTERVAL);
	}, CHECK_INTERVAL);
});

interface Command {
	data: SlashCommandOptionsOnlyBuilder;
	execute(interaction: ChatInputCommandInteraction): Promise<void>;
}

const commands = new Collection<string, Command>();

commands.set("players", {
	data: new SlashCommandBuilder()
		.addBooleanOption(
			new SlashCommandBooleanOption().setName("all_players").setDescription("show all players (even offline ones)?"),
		)
		.addBooleanOption(
			new SlashCommandBooleanOption().setName("join_count").setDescription("show join counts for players?"),
		)
		.setName("players")
		.setDescription("Gets players from current appleMC server."),
	execute: async (interaction) => {
		const status = await get_status(2);

		if (!status) {
			await interaction.reply(`Server is offline!`);
			return;
		}

		const cur_seconds = get_current_seconds();

		const server_name = clear_color_tags(status.hostname);

		const show_all = interaction.options.getBoolean("all_players", false) ?? false;
		const show_counts = interaction.options.getBoolean("join_count", false) ?? false;

		let out: string;

		if (!show_all) {
			out = `**Current players on '${server_name}' (${status.numplayers}/${status.maxplayers})**:`;
			for (const name of status.players) {
				let diff_in_s = -1;
				let total_s = -1;
				let count = -1;

				const join_time = states.last_players.get(name);
				if (join_time)
					diff_in_s = cur_seconds - join_time;

				const player_data = get_player.firstEntry({ name: name, time: cur_seconds });
				if (player_data) {
					total_s = player_data.time;
					count = player_data.count;
				}

				out += `\n- '${name}' (current online time: ${human_readable_time_diff(diff_in_s)}, total: ${
					human_readable_time_diff(total_s)
				}`;
				out += show_counts ? `, joined ${count} times` : "";
				out += ")";
			}
		} else {
			out = `**All players on '${server_name}'**:`;
			const db_players = get_all_players.allEntries({ time: cur_seconds });

			for (const player of db_players) {
				let total_s = -1;
				let count = -1;

				if (player) {
					total_s = player.time;
					count = player.count;
				}

				out += `\n- '${player.name}' (total: ${human_readable_time_diff(total_s)}`;
				out += show_counts ? `, joined ${count} times` : "";
				out += ")";
			}
		}

		await interaction.reply(out);
	},
});

const commands_json: RESTPostAPIChatInputApplicationCommandsJSONBody[] = [];
commands.forEach((v) => commands_json.push(v.data.toJSON()));

const rest = new REST().setToken(Deno.env.get("TOKEN") || "");

(async () => {
	try {
		log(LOG_TAGS.INFO, `Started refreshing ${commands_json.length} application (/) commands.`);

		const data = await rest.put(
			Deno.env.has("GUILD_ID")
				? Routes.applicationGuildCommands(Deno.env.get("APP_ID") || "", Deno.env.get("GUILD_ID") || "")
				: Routes.applicationCommands(Deno.env.get("APP_ID") || ""),
			{ body: commands_json },
		) as unknown[];

		log(LOG_TAGS.INFO, `Successfully reloaded ${data.length} application (/) commands.`);
	} catch (error) {
		if (error instanceof Error)
			log(LOG_TAGS.ERROR, error.message);
		else
			console.error("BIG ERROR: ", error);
	}
})();

client.on(Events.InteractionCreate, async (interaction) => {
	if (!interaction.isChatInputCommand()) return;

	const command = commands.get(interaction.commandName);

	if (!command) {
		log(LOG_TAGS.WARNING, `No command matching '${interaction.commandName}' was found.`);
		return;
	}

	try {
		await command.execute(interaction);
	} catch (error) {
		if (error instanceof Error)
			log(LOG_TAGS.ERROR, error.message);
		else
			console.error("BIG ERROR: ", error);

		if (interaction.replied || interaction.deferred) {
			await interaction.followUp({
				content: "There was an error while executing this command!",
				flags: MessageFlags.Ephemeral,
			});
		} else {
			await interaction.reply({
				content: "There was an error while executing this command!",
				flags: MessageFlags.Ephemeral,
			});
		}
	}
});

await client.login(Deno.env.get("TOKEN"));
