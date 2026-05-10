# Minecraft query discord bot

A random dc bot I wrote for my minecraft server, so my friends can know who is in game or if the server is even up (and later made it to check mod changes).

## Running
1. Install [deno](https://github.com/denoland/deno/)
1. Copy/rename `.env.sample` to `.env` and edit it
1. (optional) Copy/rename `config.toml.sample` to `config.toml` and edit it
1. Run `deno run main` (if it needs permission, allow/decline them or run `deno run main_unsecure` instead)

## Running with docker
1. Install `docker` and `docker compose`
1. Copy/rename `.env.sample` to `.env` and edit it
1. (optional) Copy/rename `config.toml.sample` to `config.toml` and edit it
1. Edit `docker-compose.yaml` and follow the comments (tldr: comment out lines if they're not set in `.env`)
1. Run `docker compose up`

To stop container run `docker compose down`

If you later change `config.toml` or `deno.json`/`deno.lock` then run `docker compose build` before running `docker compose up` again