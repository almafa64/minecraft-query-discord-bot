# Minecraft query discord bot

A random dc bot I wrote for my minecraft server, so my friends can know who is in game or if the server is even up (and later made it to check mod changes).

## Running
1. Install [deno](https://github.com/denoland/deno/)
2. Run `deno run main` (if it needs permission allow/decline them or run `deno run main_unsecure` instead)

## Environment settings
use `.env` file or set them from terminal<br>
(mod hoster = [my mod hoster server](https://github.com/almafa64/minecraft-mod-hoster))
```ini
TOKEN = "<bot token>"
APP_ID = "(application ID)" # needed for slash command registering
MC_CHANNEL = "(channel id to send player/server changes)" # needed for sending automatic discord messages
GUILD_ID = "(id of server)" # set to register slash commands only in one server instead of registering it globally (way faster register time)
PORT = "(query port)" # if not set then default (25565) is used.
HOST = "(mc server ip/domain)" # if not set then default (127.0.0.1) is used.

# Don't need to set both path, prefer HOSTER_BRANCH_PATH if you have mod hoster 
HOSTER_BRANCH_PATH = "(path to hoster's branch folder which is used for the server)" # checks new/deleted mods in mod hoster's branch folder (only works if server is on same machine and this code has read permission to that folder)
SERVER_MODS_PATH = "(path to server's mods folder)" # checks new/deleted mods in server's mods folder (only works if server is on same machine and this code has read permission to that folder)
```