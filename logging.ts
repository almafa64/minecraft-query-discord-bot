import * as path from "@std/path";
import * as fs from "@std/fs";

export function pad_number(num: number, digit = 2) {
	return num.toString().padStart(digit, "0");
}

/**
 * Formats a date object into the format `yyyy. mm. dd. hh:mm:ss`
 */
export function format_date(date: Date) {
	// z as in "zero", want to keep return short
	const z = pad_number;
	return `${date.getFullYear()}.${z(date.getMonth() + 1)}.${z(date.getDate())}. ${z(date.getHours())}:${
		z(date.getMinutes())
	}:${z(date.getSeconds())}`;
}

export enum LOG_TAGS {
	INFO = "info",
	WARNING = "warn",
	ERROR = "error",
}

const LONGEST_TAG_LENGTH = Math.max(
	...Object.values(LOG_TAGS).map((v) => v.length),
);

function get_log_name() {
	return "latest.log";
	/*
	// z as in "zero pad", want to keep return short
	const z = pad_number;
	const date = new Date();
	return `${date.getFullYear()}-${z(date.getMonth() + 1)}-${z(date.getDate())}_${z(date.getHours())}-${
		z(date.getMinutes())
	}-${z(date.getSeconds())}.log`;*/
}

let _log_file: Deno.FsFile | undefined = undefined;
async function setup_logging() {
	if(_log_file) return _log_file;

	const LOGS_DIR_PATH = path.resolve("./logs");

	await fs.ensureDir(LOGS_DIR_PATH);
	_log_file = await Deno.open(path.join(LOGS_DIR_PATH, get_log_name()), {
		write: true,
		create: true,
		truncate: true,
	});

	return _log_file;
}

/**
 * Log msg to console and into a file
 * @param file if undefined makes a custom log file (based on {@link get_log_name})
 */
export async function tee(msg: string, file?: Deno.FsFile) {
	console.log(msg);

	const encoder = new TextEncoder();
	const data = encoder.encode(msg + "\n");

	if (file)
		await file.write(data);
	else {
		const log_file = await setup_logging();
		await log_file.write(data);
	}
}

/**
 * Logs to console and log file in format `"[hhhh. mm. dd. hh:mm:ss] [<tag>]<padding space if needed> <job>"` (time is local timezone)
 */
export async function log(tag: LOG_TAGS, job: string) {
	const date = new Date();
	await tee(`[${format_date(date)}] [${tag}]${" ".padEnd(LONGEST_TAG_LENGTH - tag.length + 1)}${job}`);
}
