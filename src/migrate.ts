import path from "node:path";
import { get_config } from "./config.ts";
import * as fs from "@std/fs";
import * as toml from "@std/toml";

const config = get_config();

async function migrate_before_data_folder() {
	// get_config() will make the data folder so cant check if that doesnt exists

	if (Deno.readDirSync(config.constants.data_folder_path).toArray().length != 0)
		return;

	const mod_names_path = path.resolve("mod_names.json");
	if (fs.existsSync(mod_names_path))
		fs.moveSync(mod_names_path, config.constants.mod_names_path);

	const db_path = path.resolve("player_data.sqlite");
	if (fs.existsSync(db_path))
		fs.moveSync(db_path, config.constants.database_path);

	const names_to_ids_file_path = path.resolve("names_to_ids.json");
	if (fs.existsSync(names_to_ids_file_path)) {
		const player_names_to_ids = await import(names_to_ids_file_path, { with: { type: "json" } });

		config.query_configs.names_to_ids = { ...player_names_to_ids, ...config.query_configs.names_to_ids };

		Deno.removeSync(names_to_ids_file_path);
	}

	const tmp = structuredClone(config);
	delete (tmp as unknown as {constants?: string}).constants;
	Deno.writeTextFileSync(config.constants.config_path, toml.stringify(tmp));
}

await migrate_before_data_folder();