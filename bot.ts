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
import { DB, QueryParameterSet, Row, RowObject } from "https://deno.land/x/sqlite/mod.ts";

const CHECK_INTERVAL = 5000;

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
const db = new DB("player_data.sqlite");

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

db.execute(`
	create table if not exists server_sessions (
		connect_time integer not null,
		disconnect_time integer
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

const get_player = db.prepareQuery<
	[string, number, number],
	{ name: string; time: number; count: number },
	{ time: number; name: string }
>(
	`SELECT players.name as name,
	COUNT(sessions.player_id) as count,
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

const get_not_disconnected_players = db.prepareQuery<
	[string, number],
	{ name: string; connect_time: number },
	QueryParameterSet
>(
	`SELECT players.name as name,
	sessions.connect_time as connect_time
	from players join sessions on sessions.player_id = players.id
	where sessions.disconnect_time is null
	group by players.id`,
);

const get_all_not_yet_players = db.prepareQuery<
	[string],
	{ name: string },
	QueryParameterSet
>(
	`SELECT name from players left join sessions on sessions.player_id = players.id where sessions.player_id is null;`,
);

const server_open_session = db.prepareQuery<Row, RowObject, { conn_time: number }>(
	"INSERT INTO server_sessions (connect_time) VALUES (:conn_time)",
);
const server_close_session = db.prepareQuery<Row, RowObject, { disconnect_time: number }>(
	"update server_sessions set disconnect_time = :disconnect_time where disconnect_time is null",
);

const get_server = db.prepareQuery<
	[number, number],
	{ time: number; count: number },
	{ time: number }
>(
	`SELECT COUNT(connect_time) as count,
	SUM((CASE WHEN disconnect_time is null then :time else disconnect_time end) - connect_time) as time
	from server_sessions`,
);

const get_server_last_conn = db.prepareQuery<[number], { time: number }, QueryParameterSet>(
	`select max(connect_time) as time from server_sessions`,
);

const states = {
	is_server_up: false,
	last_players: new Map<string, number>(),
	name: "",
};

// TODO: temporary, bot can run way after the last server shutdown
//db.execute(`UPDATE sessions set disconnect_time = ${get_current_seconds()} where disconnect_time is null`);

// TODO: (WIP)
//     continue from last counting
//          - power outage / bot goes down -> players dont disconnet -> next start can be hours/days later so players have been "online" for that time
//          - better solution: write to file last check() time
//                if only x time (seconds/few minutes) has passed after restart
//                    load in players from db and continue, else close sessions
const tmp_status = await get_status(3);
if (tmp_status) {
	states.is_server_up = true;
	states.name = clear_color_tags(tmp_status.hostname);
	get_not_disconnected_players.allEntries().forEach((v) => {
		states.last_players.set(v.name, v.connect_time);
	});
}

function zip<A, B>(a: A[], b: B[]) {
	return a.map((v, i) => [v, b[i]] as [A, B]);
}

function get_current_seconds(date: Date | undefined = undefined) {
	return Math.floor((date ?? new Date()).getTime() / 1000);
}

function human_readable_time(s: number) {
	if (s < 0) return s;

	const hours = Math.floor(s / 3600);
	s -= 3600 * hours;

	const minutes = Math.floor(s / 60);
	s -= 60 * minutes;

	const seconds = Math.floor(s);

	const out = [];
	if (hours > 0) out.push(`${hours}h`);
	if (minutes > 0) out.push(`${minutes}m`);
	if (seconds > 0) out.push(`${seconds}s`);

	return out.join(" ");
}

function readable_time(s: number, format: "h" | "m" | "s" = "h", digits = 2) {
	switch (format) {
		case "h":
			return (s / 3600).toFixed(digits);
		case "m":
			return (s / 60).toFixed(digits);
		case "s":
			return s.toFixed(digits);
	}
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

let ch: SendableChannels | undefined;
async function get_channel() {
	if (ch) return ch;

	const send_ch = client.channels.cache.get(Deno.env.get("MC_CHANNEL") ?? "");
	if (send_ch === undefined) {
		await log(LOG_TAGS.WARNING, `Cant find '${Deno.env.get("MC_CHANNEL")}' channel. Turning off notification system.`);
		return undefined;
	}

	if (!send_ch.isSendable) {
		await log(
			LOG_TAGS.WARNING,
			`Channel '${Deno.env.get("MC_CHANNEL")}' isnt sendable. Turning off notification system.`,
		);
		return undefined;
	}

	ch = send_ch as SendableChannels;
	// TODO: get name
	await log(LOG_TAGS.INFO, `Using channel '${ch.id}' for notifications.`);

	return ch;
}

async function check() {
	const send_ch = await get_channel();
	if (!send_ch) return;

	let status = await get_status(1);

	const cur_time = new Date();
	const cur_seconds = get_current_seconds(cur_time);
	const formatted_time = format_date(cur_time);

	if (status)
		states.name = clear_color_tags(status.hostname);

	if (!states.is_server_up && status) {
		states.is_server_up = true;
		server_open_session.execute({ conn_time: cur_seconds });

		await send_ch.send(`server **${states.name}** is **up** (${formatted_time})!`);
	} else if (states.is_server_up && !status) {
		states.is_server_up = false;
		server_close_session.execute({ disconnect_time: cur_seconds });

		const server_last_up = get_server_last_conn.firstEntry();

		let msg = `server **${states.name}** is **down** (${formatted_time})`;
		if (server_last_up) msg += ` after ${human_readable_time(cur_seconds - server_last_up.time)}`;
		msg += "!";
		await send_ch.send(msg);

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
		msg += `**Player(s) joined** (${formatted_time}):\n- ${players_joined.toSorted().join("\n- ")}\n`;

	if (players_left.length != 0) {
		msg += `**Player(s) left** (${formatted_time}):\n`;
		for (const [k, v] of zip(players_left, player_time_diff_s).toSorted((a, b) => b[1] - a[1])) {
			// INFO: human_readable_time_diff can return empty string if player joined and left under a second
			msg += `- ${k} (after ${human_readable_time(v)} of gaming)\n`;
		}
	}

	if (parseInt(status.numplayers) > 0)
		msg += `**Current players**: ${status.players.toSorted().join(", ")}`;
	else
		msg += `Server is empty`;

	await send_ch.send(msg);
}

client.once(Events.ClientReady, async (client) => {
	await log(LOG_TAGS.INFO, `logged in as ${client.user.tag}`);

	if (await get_channel()) {
		setTimeout(async function test() {
			await check();
			setTimeout(test, CHECK_INTERVAL);
		}, CHECK_INTERVAL);
	}
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
			new SlashCommandBooleanOption().setName("session_count").setDescription("show session counts for players?"),
		)
		.setName("players")
		.setDescription(
			"Gets players from appleMC server (current time, total time, session counts, avarage hour/session).",
		),
	execute: async (interaction) => {
		const status = await get_status(2);

		if (!status) {
			await interaction.reply(`Server is offline!`);
			return;
		}

		const cur_seconds = get_current_seconds();

		const server_name = clear_color_tags(status.hostname);

		const show_all = interaction.options.getBoolean("all_players", false) ?? false;
		const show_counts = interaction.options.getBoolean("session_count", false) ?? false;

		let out: string;

		if (!show_all) {
			out = `**Current players on '${server_name}' (${status.numplayers}/${status.maxplayers})**:`;

			const db_players = status.players.map((v) => {
				return get_player.firstEntry({ name: v, time: cur_seconds });
			}).filter((v) => v !== undefined);

			for (const player of db_players.toSorted((a, b) => b.time - a.time)) {
				let diff_in_s = -1;
				let total_s = -1;
				let count = -1;

				const join_time = states.last_players.get(player.name);
				if (join_time)
					diff_in_s = cur_seconds - join_time;

				if (player) {
					total_s = player.time;
					count = player.count;
				}

				out += `\n1. **${player.name}** (current online time: ${human_readable_time(diff_in_s)}, total: ${
					human_readable_time(total_s)
				}`;
				out += show_counts ? `, joined ${count} times, ${readable_time(total_s / count)}h/session` : "";
				out += ")";
			}
		} else {
			out = `**All players on '${server_name}'**:`;
			const db_players = get_all_players.allEntries({ time: cur_seconds });

			for (const player of db_players.toSorted((a, b) => b.time - a.time)) {
				let total_s = -1;
				let count = -1;

				if (player) {
					total_s = player.time;
					count = player.count;
				}

				out += `\n1. **${player.name}** (total: ${human_readable_time(total_s)}`;
				out += show_counts ? `, joined ${count} times, ${readable_time(total_s / count)}h/session` : "";
				out += ")";
			}

			const db_not_yet_players = get_all_not_yet_players.all().map((v) => v[0]);
			for (const player of db_not_yet_players) {
				out += `\n1. **${player}** (total: never played`;
				out += show_counts ? `, joined 0 times, 0h/session` : "";
				out += ")";
			}
		}

		await interaction.reply(out);
	},
});

commands.set("server", {
	data: new SlashCommandBuilder()
		.addBooleanOption(
			new SlashCommandBooleanOption().setName("session_count").setDescription("show session count?"),
		)
		.setName("server")
		.setDescription(
			"Gets appleMC server data (current uptime, total uptime, session counts, avarage hour/session).",
		),
	execute: async (interaction) => {
		const status = await get_status(2);

		if (!status) {
			await interaction.reply(`Server is offline!`);
			return;
		}

		const cur_seconds = get_current_seconds();
		const server_name = clear_color_tags(status.hostname);
		const show_counts = interaction.options.getBoolean("session_count", false) ?? false;

		let diff_in_s = -1;
		let total_s = -1;
		let count = -1;

		const server_data = get_server.firstEntry({ time: cur_seconds });
		const server_last_up = get_server_last_conn.firstEntry();

		if (server_last_up)
			diff_in_s = cur_seconds - server_last_up.time;

		if (server_data) {
			total_s = server_data.time;
			count = server_data.count;
		}

		let out = `**Current status of '${server_name}'**:\n`;
		out += `- **Current uptime**: ${human_readable_time(diff_in_s)}\n`;
		out += `- **Total uptime**: ${human_readable_time(total_s)}`;

		if (show_counts) {
			out += `\n- **Session count**: ${count}\n`;
			out += `- **Average hours/session**: ${readable_time(total_s / count)}h`;
		}

		await interaction.reply(out);
	},
});

const commands_json: RESTPostAPIChatInputApplicationCommandsJSONBody[] = [];
commands.forEach((v) => commands_json.push(v.data.toJSON()));

const rest = new REST().setToken(Deno.env.get("TOKEN") ?? "");

(async () => {
	try {
		await log(LOG_TAGS.INFO, `Started refreshing ${commands_json.length} application (/) commands.`);

		const data = await rest.put(
			Deno.env.has("GUILD_ID")
				? Routes.applicationGuildCommands(Deno.env.get("APP_ID") ?? "", Deno.env.get("GUILD_ID") ?? "")
				: Routes.applicationCommands(Deno.env.get("APP_ID") ?? ""),
			{ body: commands_json },
		) as unknown[];

		await log(LOG_TAGS.INFO, `Successfully reloaded ${data.length} application (/) commands.`);
	} catch (error) {
		if (error instanceof Error)
			await log(LOG_TAGS.ERROR, error.message);
		else
			console.error("BIG ERROR: ", error);
	}
})();

client.on(Events.InteractionCreate, async (interaction) => {
	if (!interaction.isChatInputCommand()) return;

	const command = commands.get(interaction.commandName);

	if (!command) {
		await log(LOG_TAGS.WARNING, `No command matching '${interaction.commandName}' was found.`);
		return;
	}

	await log(
		LOG_TAGS.INFO,
		`'${interaction.user.tag}' run '${interaction.commandName}' with options ${
			JSON.stringify(interaction.options.data)
		}`,
	);

	try {
		await command.execute(interaction);
	} catch (error) {
		if (error instanceof Error)
			await log(LOG_TAGS.ERROR, error.message);
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
