import * as toml from "@std/toml";
import * as fs from "@std/fs";
import * as path from "@std/path";

export type QueryConfigs = {
	convert_player_names_to_dc_ids: boolean;
	query_interval: number;
	names_to_ids: Record<string, string>;
};

export type ModConfigs = {
	check_interval: number;
};

export type ConstantConfigs = {
	mod_names_path: string;
	database_path: string;
	data_folder_path: string;
	config_path: string;
};

export type AppConfig = {
	query_configs: QueryConfigs;
	mod_configs: ModConfigs;
	constants: ConstantConfigs;
};

let global_config: AppConfig | undefined;

function load_config() {
	const CONFIG_PATH = path.resolve("config.toml");
	const DATA_FOLDER_PATH = path.resolve("data");
	
	fs.ensureDirSync(DATA_FOLDER_PATH);

	let config: AppConfig;

	if (!fs.existsSync(CONFIG_PATH, { isReadable: true, isFile: true }))
		config = {} as AppConfig;
	else
		config = toml.parse(Deno.readTextFileSync(CONFIG_PATH)) as AppConfig;

	config.query_configs ??= {} as QueryConfigs;
	config.query_configs.convert_player_names_to_dc_ids ??= false;
	config.query_configs.query_interval ??= 5000;
	config.query_configs.names_to_ids ??= {};

	config.mod_configs ??= {} as ModConfigs;
	config.mod_configs.check_interval ??= 20 * 1000;

	config.constants = {
		mod_names_path: path.join(DATA_FOLDER_PATH, "mod_names.json"),
		database_path: path.join(DATA_FOLDER_PATH, "player_data.sqlite"),
		data_folder_path: DATA_FOLDER_PATH,
		config_path: CONFIG_PATH,
	};

	return config;
}

export function get_config() {
	global_config ??= load_config();
	return global_config;
}

load_config();
