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
	SlashCommandBuilder,
} from "npm:discord.js";
import { get_status } from "./api.ts";
import "jsr:@std/dotenv/load";
import { format_date, log, LOG_TAGS } from "./logging.ts";

const CHECK_INTERVAL = 5000;

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

function zip<A, B>(a: A[], b: B[]) {
	return a.map((v, i) => [v, b[i]] as [A, B]);
}

function human_readable_time_diff(diff_in_s: number) {
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

	const status = await get_status(1);

	let cur_time = new Date();
	const formatted_time = format_date(cur_time);

	if (status)
		states.name = clear_color_tags(status.hostname);

	if (!states.is_server_up && status) {
		await send_ch.send(`server '${states.name}' is up (${formatted_time})!`);
		states.is_server_up = true;
	} else if (states.is_server_up && !status) {
		await send_ch.send(`server '${states.name}' is down (${formatted_time})!`);
		states.is_server_up = false;
		return;
	}

	if (!status)
		return;

	if (status.players.length === states.last_players.size && status.players.every((v) => states.last_players.has(v)))
		return;

	cur_time = new Date();
	const cur_players = new Set(status.players);

	const players_joined = [...cur_players].filter((v) => !states.last_players.has(v));
	const players_left = [...states.last_players.keys()].filter((v) => !cur_players.has(v));
	const player_time_diff_s = players_left.map((v) => {
		const join_time = states.last_players.get(v);
		if (join_time === undefined) return -1;
		return (cur_time.getTime() - join_time) / 1000;
	});

	players_left.forEach((v) => states.last_players.delete(v));
	players_joined.forEach((v) => states.last_players.set(v, cur_time.getTime()));

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

	send_ch.send(msg);
}

client.once(Events.ClientReady, (client) => {
	log(LOG_TAGS.INFO, `logged in as ${client.user.tag}`);

	setTimeout(async function test() {
		await check();
		setTimeout(test, CHECK_INTERVAL);
	}, CHECK_INTERVAL);
});

interface Command {
	data: SlashCommandBuilder;
	execute(interaction: ChatInputCommandInteraction): Promise<void>;
}

const commands = new Collection<string, Command>();

commands.set("players", {
	data: new SlashCommandBuilder()
		.setName("players")
		.setDescription("Gets players from current appleMC server."),
	execute: async (interaction) => {
		const status = await get_status(2);

		if (!status) {
			await interaction.reply(`Server is offline!`);
			return;
		}

		const name = clear_color_tags(status.hostname);

		if (status.players.length === 0) {
			await interaction.reply(`**Current players on '${name}' (0/${status.maxplayers})**:`);
			return;
		}

		await interaction.reply(
			`**Current players on '${name}' (${status.numplayers}/${status.maxplayers})**:\n- '${
				status.players.join("'\n- '")
			}'`,
		);
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

client.login(Deno.env.get("TOKEN"));
