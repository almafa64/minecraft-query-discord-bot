import { Parser } from "binary-parser-encoder";
import { log, LOG_TAGS } from "./logging.ts";
import "@std/dotenv/load";

const MAGIC = 0xFEFD;
const HOSTNAME = Deno.env.get("HOST") || "127.0.0.1";
const PORT = parseInt(Deno.env.get("PORT") || "25565");

const HandshakeReq = new Parser()
	.uint16be("magic", { assert: MAGIC })
	.uint8("type", { assert: 9 })
	.uint32be("id");

const HandshakeResp = new Parser()
	.uint8("type", { assert: 9 })
	.uint32be("id")
	.string("token", { zeroTerminated: true });

const StatusReq = new Parser()
	.uint16be("magic", { assert: MAGIC })
	.uint8("type", { assert: 0 })
	.uint32be("id")
	.uint32be("token")
	.skip(4);

const StatusResp = new Parser()
	.uint8("type", { assert: 0 })
	.uint32be("id")
	.skip(11)
	.nest("", {
		type: new Parser()
			.skip("hostname".length + 1)
			.string("hostname", { encoding: "iso-8859-2", zeroTerminated: true })
			.skip("gametype".length + 1)
			.string("gametype", { encoding: "iso-8859-2", zeroTerminated: true })
			.skip("game_id".length + 1)
			.string("game_id", { encoding: "iso-8859-2", zeroTerminated: true })
			.skip("version".length + 1)
			.string("version", { encoding: "iso-8859-2", zeroTerminated: true })
			.skip("plugins".length + 1)
			.string("plugins", { encoding: "iso-8859-2", zeroTerminated: true })
			.skip("map".length + 1)
			.string("map", { encoding: "iso-8859-2", zeroTerminated: true })
			.skip("numplayers".length + 1)
			.string("numplayers", { encoding: "iso-8859-2", zeroTerminated: true })
			.skip("maxplayers".length + 1)
			.string("maxplayers", { encoding: "iso-8859-2", zeroTerminated: true })
			.skip("hostport".length + 1)
			.string("hostport", { encoding: "iso-8859-2", zeroTerminated: true })
			.skip("hostip".length + 1)
			.string("hostip", { encoding: "iso-8859-2", zeroTerminated: true })
			.skip(1),
	})
	.skip(10)
	.array("players", {
		type: new Parser().string("", { encoding: "iso-8859-2", zeroTerminated: true }),
		readUntil: "eof",
	});

export interface Status {
	type: number;
	id: number;
	hostname: string;
	gametype: string;
	game_id: string;
	version: string;
	plugins: string;
	map: string;
	numplayers: string;
	maxplayers: string;
	hostport: string;
	hostip: string;
	players: string[];
}

export async function get_status(id: number) {
	const listener = Deno.listenDatagram({
		port: 0,
		transport: "udp",
	});

	// 2s of timout
	const timout = setTimeout(() => {
		log(LOG_TAGS.WARNING, "timouted");
		listener.close();
	}, 2000);

	const peerAddress: Deno.NetAddr = {
		transport: "udp",
		hostname: HOSTNAME,
		port: PORT,
	};

	try {
		const handshake_req_buffer = HandshakeReq.encode({ "magic": MAGIC, "type": 9, "id": id });
		await listener.send(new Uint8Array(handshake_req_buffer), peerAddress);
		const handshake_resp_buffer = (await listener.receive())[0];
		const handshake_resp = HandshakeResp.parse(handshake_resp_buffer);

		const token = parseInt(handshake_resp.token);

		const status_req_buffer = StatusReq.encode({ "magic": MAGIC, "type": 0, "id": id, "token": token });
		await listener.send(new Uint8Array(status_req_buffer), peerAddress);
		const status_resp_buffer = (await listener.receive())[0];
		const status_resp: Status = StatusResp.parse(status_resp_buffer.slice(0, status_resp_buffer.length - 1));

		clearTimeout(timout);
		return status_resp;
	} catch {
		return undefined;
	}
}
