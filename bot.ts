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
import { log, LOG_TAGS } from "./logging.ts";

const CHECK_INTERVAL = 5000;

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

function clear_colortags(tagged_name: string) {
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
	last_players: new Set<string>(),
	name: "",
};

function get_channel() {
	const ch = client.channels.cache.get(Deno.env.get("MC_CHANNEL") || "");
	if (ch === undefined) {
		log(LOG_TAGS.ERROR, "Cant find channel");
		return;
	}

	if (!ch.isSendable) {
		log(LOG_TAGS.ERROR, "Channel isnt sendable");
		return;
	}

	return ch as SendableChannels;
}

async function check() {
	const send_ch = get_channel();
	if (!send_ch) return;

	const status = await get_status(1);

	if (status)
		states.name = clear_colortags(status.hostname);

	if (!states.is_server_up && status) {
		send_ch.send(`server '${states.name}' is up!`);
		states.is_server_up = true;
	} else if (states.is_server_up && !status) {
		send_ch.send(`server '${states.name}' is down!`);
		states.is_server_up = false;
		return;
	}

	if (!status)
		return;

	if (status.players.length === states.last_players.size && status.players.every((v) => states.last_players.has(v)))
		return;

	const cur_players = new Set(status.players);

	const players_joined = [...cur_players].filter((v) => !states.last_players.has(v));
	const players_left = [...states.last_players].filter((v) => !cur_players.has(v));

	states.last_players.clear();
	status.players.forEach((v) => states.last_players.add(v));

	let msg = "";

	if (players_joined.length != 0)
		msg += `**Player(s) joined**:\n- '${players_joined.join("'\n- '")}'`;

	if (players_left.length != 0)
		msg += `**Player(s) left**:\n- '${players_left.join("'\n- '")}'`;

	msg += `\n**Current player count**: ${status.numplayers}/${status.maxplayers}`;

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
		const send_ch = get_channel();
		if (!send_ch) return;

		const status = await get_status(2);

		if (!status) {
			await interaction.reply(`Server is offline!`);
			return;
		}

		const name = clear_colortags(status.hostname);

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

// and deploy your commands!
(async () => {
	try {
		log(LOG_TAGS.INFO, `Started refreshing ${commands_json.length} application (/) commands.`);

		// The put method is used to fully refresh all commands in the guild with the current set
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
