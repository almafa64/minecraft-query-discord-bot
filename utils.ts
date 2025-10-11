import {
	Client,
	SendableChannels,
} from "discord.js";
import { log, LOG_TAGS } from "./logging.ts";

const MC_CHANNEL = Deno.env.get("MC_CHANNEL");

/**
 * Zips 2 array into 1, b is trimmed to a.length
 */
export function zip<A, B>(a: A[], b: B[]) {
	return a.map((v, i) => [v, b[i]] as [A, B]);
}

/**
 * Returns seconds since UNIX epoch
 * @param date date to use, default is current time
 */
export function get_seconds(date?: Date) {
	return Math.floor((date ?? new Date()).getTime() / 1000);
}

/**
 * Returns seconds in a readable format in format `"xh ym zs"`
 * if part is 0 (e.g. h == 0) then it's left out
 * @returns string in format `"xh ym zs"` or if seconds is negative `"error: <seconds>"`
 */
export function human_readable_time(seconds: number) {
	if (seconds < 0) return `error: ${seconds}`;

	const h = Math.floor(seconds / 3600);
	seconds -= 3600 * h;

	const m = Math.floor(seconds / 60);
	seconds -= 60 * m;

	const s = Math.floor(seconds);

	const out: string[] = [];
	if (h > 0) out.push(`${h}h`);
	if (m > 0) out.push(`${m}m`);
	if (s > 0) out.push(`${s}s`);

	return out.join(" ");
}

/**
 * Returns seconds converted to another unit rounded to digits as a string
 * @param format time unit (default = "h")
 * @param digits how many decimal digits should there be (default = 2)
 */
export function readable_time(seconds: number, format: "h" | "m" | "s" = "h", digits = 2) {
	switch (format) {
		case "h":
			return (seconds / 3600).toFixed(digits);
		case "m":
			return (seconds / 60).toFixed(digits);
		case "s":
			return seconds.toFixed(digits);
	}
}

/**
 * Returns new string without minecraft color tags (§x)
 */
export function clear_color_tags(tagged_string: string) {
	let name = "";
	let i = 0;

	while (i < tagged_string.length) {
		const chr = tagged_string[i];
		if (chr === "§") {
			i += 2;
			continue;
		}

		name += chr;
		i++;
	}

	return name;
}

let _ch: SendableChannels | undefined;
/**
 * Gets discord channel to send notifications to
 */
export async function get_channel(client: Client) {
	if (_ch) return _ch;

	const send_ch = client.channels.cache.get(MC_CHANNEL ?? "");
	if (send_ch === undefined) {
		await log(LOG_TAGS.WARNING, `Cant find '${MC_CHANNEL}' channel. Turning off notification system.`);
		return undefined;
	}

	if (!send_ch.isSendable) {
		await log(
			LOG_TAGS.WARNING,
			`Channel '${MC_CHANNEL}' isnt sendable. Turning off notification system.`,
		);
		return undefined;
	}

	_ch = send_ch as SendableChannels;
	// TODO: get name
	await log(LOG_TAGS.INFO, `Using channel '${_ch.id}' for notifications.`);

	return _ch;
}