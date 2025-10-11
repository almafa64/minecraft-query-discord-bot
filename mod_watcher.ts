import * as fs from "@std/fs";
import * as path from "@std/path";
import { format_date, log, LOG_TAGS } from "./logging.ts";
import { Client, SendableChannels } from "discord.js";
import { get_channel } from "./utils.ts";

const CHECK_INTERVAL = 10000;
const MOD_NAMES_FILE_NAME = "mod_names.json";

if (!await fs.exists(MOD_NAMES_FILE_NAME, { isFile: true, isReadable: true }))
	await Deno.writeFile(MOD_NAMES_FILE_NAME, new TextEncoder().encode("{}"));

let client: Client;

class HosterData {
	both: Set<string>;
	client_only: Set<string>;
	server_only: Set<string>;
	both_optional: Set<string>;
	client_optional: Set<string>;

	constructor() {
		this.both = new Set();
		this.client_only = new Set();
		this.server_only = new Set();
		this.both_optional = new Set();
		this.client_optional = new Set();
	}
}

interface ModsData {
	hoster?: HosterData;
	server?: Set<string>;
	dirty: boolean;
}

type StringModsData = {
	hoster?: {
		both: string[];
		client_only: string[];
		server_only: string[];
		both_optional: string[];
		client_optional: string[];
	};
	server?: string[];
};

enum ModPathsToCheck {
	None = 0,
	Server = 1 << 0,
	Hoster = 1 << 1,
}

const mods_path_data = {
	hoster_branch_path: "",
	server_mods_path: "",
	to_check: ModPathsToCheck.None,
};

const last_mods_data: ModsData = parse_mod_data(JSON.parse(await Deno.readTextFile(MOD_NAMES_FILE_NAME)));

await (async () => {
	const hoster_branch_path = Deno.env.get("HOSTER_BRANCH_PATH");
	const server_mods_path = Deno.env.get("SERVER_MODS_PATH");

	if (hoster_branch_path && hoster_branch_path.length > 0 && await fs.exists(hoster_branch_path)) {
		mods_path_data.to_check |= ModPathsToCheck.Hoster;
		mods_path_data.hoster_branch_path = hoster_branch_path;

		if (!last_mods_data.hoster)
			last_mods_data.hoster = new HosterData();

		await mod_log(LOG_TAGS.INFO, `Found mod hoster's branch folder (${hoster_branch_path})`);
	} else if(last_mods_data.hoster) {
		last_mods_data.hoster = undefined;
		last_mods_data.dirty = true;

		await mod_log(LOG_TAGS.WARNING, `Hoster's branch path got removed, deleting saved mod names`);
	}

	if (server_mods_path && server_mods_path.length > 0 && await fs.exists(server_mods_path)) {
		mods_path_data.to_check |= ModPathsToCheck.Server;
		mods_path_data.server_mods_path = server_mods_path;

		if (!last_mods_data.server)
			last_mods_data.server = new Set();

		await mod_log(LOG_TAGS.INFO, `Found server's mods folder (${server_mods_path})`);
	} else if(last_mods_data.server) {
		last_mods_data.server = undefined;
		last_mods_data.dirty = true;

		await mod_log(LOG_TAGS.WARNING, `Server's mods path got removed, deleting saved mod names`);
	}
})();

function parse_mod_data(string_mod_data: StringModsData) {
	const mod_data: ModsData = { dirty: false };

	if (string_mod_data.hoster) {
		mod_data.hoster = new HosterData();
		mod_data.hoster.both = new Set(string_mod_data.hoster.both);
		mod_data.hoster.client_only = new Set(string_mod_data.hoster.client_only);
		mod_data.hoster.server_only = new Set(string_mod_data.hoster.server_only);
		mod_data.hoster.both_optional = new Set(string_mod_data.hoster.both_optional);
		mod_data.hoster.client_optional = new Set(string_mod_data.hoster.client_optional);
	}

	if (string_mod_data.server)
		mod_data.server = new Set(string_mod_data.server);

	return mod_data;
}

function stringify_mod_data(mod_data: ModsData) {
	const string_mod_data: StringModsData = {};

	if (mod_data.server)
		string_mod_data.server = Array.from(mod_data.server);

	if (mod_data.hoster) {
		string_mod_data.hoster = {
			both: Array.from(mod_data.hoster.both),
			client_only: Array.from(mod_data.hoster.client_only),
			server_only: Array.from(mod_data.hoster.server_only),
			both_optional: Array.from(mod_data.hoster.both_optional),
			client_optional: Array.from(mod_data.hoster.client_optional),
		};
	}

	return JSON.stringify(string_mod_data);
}

async function mod_log(tag: LOG_TAGS, msg: string) {
	await log(tag, `[MOD_WATCHER] ${msg}`);
}

async function get_mod_names(path: string) {
	return new Set((await Array.fromAsync(fs.expandGlob(path, { includeDirs: false }))).map((v) => v.name));
}

/**
 * Splits msg into chunks that fit into discord's message limit. It only splits on new lines
 */
async function* split_for_discord(msg: string) {
	let start = 0;
	while (true) {
		const end = start + 2000;
		const sliced = msg.slice(start, end);

		if (end >= msg.length) {
			yield sliced;
			break;
		} else {
			const new_end = sliced.lastIndexOf("\n");
			const new_sliced = sliced.slice(0, new_end);

			yield new_sliced;

			start += new_end + 1;
		}
	}
}

function diff_to_msg(added: Set<string>, removed: Set<string>) {
	let msg = "";

	if (removed.size > 0)
		msg += `- \\- **${removed.keys().toArray().toSorted().join("**\n- \\- **")}**\n`;

	if (added.size > 0)
		msg += `- + **${added.keys().toArray().toSorted().join("**\n- + **")}**\n`;

	return msg;
}

async function check_hoster(cur_date: Date, send_ch: SendableChannels) {
	if (!(mods_path_data.to_check & ModPathsToCheck.Hoster) || !last_mods_data.hoster) return;

	enum ModName {
		BOTH,
		CLIENT,
		SERVER,
		BOTH_OPT,
		CLIENT_OPT,
	}

	const mod_names_all = [
		await get_mod_names(path.join(mods_path_data.hoster_branch_path, "both", "*.jar")),
		await get_mod_names(path.join(mods_path_data.hoster_branch_path, "client_only", "*.jar")),
		await get_mod_names(path.join(mods_path_data.hoster_branch_path, "server_only", "*.jar")),
		await get_mod_names(path.join(mods_path_data.hoster_branch_path, "both", "optional", "*.jar")),
		await get_mod_names(path.join(mods_path_data.hoster_branch_path, "client_only", "optional", "*.jar")),
	];

	// remove all names from hoster's sets that are in server's set
	if (last_mods_data.server) {
		for (const [i, mod_names] of mod_names_all.entries())
			mod_names_all[i] = mod_names.difference(last_mods_data.server);
	}

	for (const [i, mod_names] of mod_names_all.entries()) {
		let name: string;
		let last_mod_names: Set<string>;

		switch (i) {
			case ModName.BOTH:
				name = "both";
				last_mod_names = last_mods_data.hoster.both;
				break;
			case ModName.CLIENT:
				name = "client";
				last_mod_names = last_mods_data.hoster.client_only;
				break;
			case ModName.SERVER:
				name = "server";
				last_mod_names = last_mods_data.hoster.server_only;
				break;
			case ModName.BOTH_OPT:
				name = "optional both";
				last_mod_names = last_mods_data.hoster.both_optional;
				break;
			case ModName.CLIENT_OPT:
				name = "optional client";
				last_mod_names = last_mods_data.hoster.client_optional;
				break;
			default:
				continue;
		}

		const removed_mod_names = last_mod_names.difference(mod_names);
		const added_mod_names = mod_names.difference(last_mod_names);

		if (removed_mod_names.size == 0 && added_mod_names.size == 0) continue;

		switch (i) {
			case ModName.BOTH:
				last_mods_data.hoster.both = mod_names;
				break;
			case ModName.CLIENT:
				last_mods_data.hoster.client_only = mod_names;
				break;
			case ModName.SERVER:
				last_mods_data.hoster.server_only = mod_names;
				break;
			case ModName.BOTH_OPT:
				last_mods_data.hoster.both_optional = mod_names;
				break;
			case ModName.CLIENT_OPT:
				last_mods_data.hoster.client_optional = mod_names;
				break;
		}

		let msg = `**Hoster's ${name} mods changed** (${format_date(cur_date)}):\n`;
		msg += diff_to_msg(added_mod_names, removed_mod_names);

		for await (const slice of split_for_discord(msg))
			await send_ch.send(slice);

		last_mods_data.dirty = true;
	}
}

async function check_server(cur_date: Date, send_ch: SendableChannels) {
	if (!(mods_path_data.to_check & ModPathsToCheck.Server) || !last_mods_data.server) return;

	let mod_names = await get_mod_names(path.join(mods_path_data.server_mods_path, "*.jar"));

	// remove all names from server's set that are in hoster's sets
	if (last_mods_data.hoster) {
		mod_names = mod_names.difference(last_mods_data.hoster.both);
		mod_names = mod_names.difference(last_mods_data.hoster.both_optional);
		mod_names = mod_names.difference(last_mods_data.hoster.server_only);
	}

	const removed_mod_names = last_mods_data.server.difference(mod_names);
	const added_mod_names = mod_names.difference(last_mods_data.server);

	if (removed_mod_names.size == 0 && added_mod_names.size == 0) return;

	last_mods_data.server = mod_names;

	let msg = `**Server's mods changed** (${format_date(cur_date)}):\n`;
	msg += diff_to_msg(added_mod_names, removed_mod_names);

	for await (const slice of split_for_discord(msg))
		await send_ch.send(slice);

	last_mods_data.dirty = true;
}

async function check() {
	const send_ch = await get_channel(client);
	if (!send_ch) return;

	const cur_date = new Date();

	await check_hoster(cur_date, send_ch);
	await check_server(cur_date, send_ch);

	if (last_mods_data.dirty) {
		last_mods_data.dirty = false;
		await Deno.writeTextFile(MOD_NAMES_FILE_NAME, stringify_mod_data(last_mods_data), { create: true });
	}
}

export function init(dc_client: Client) {
	client = dc_client;

	setTimeout(async function run() {
		await check();
		setTimeout(run, CHECK_INTERVAL);
	}, CHECK_INTERVAL);
}
