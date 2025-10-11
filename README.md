# Minecraft query discord bot

A random dc bot I wrote for my server, so my friends can know who is in game or if the server is even up.

## Environment settings
(use .env file)<br>
(mod hoster = [my mod hoster server](https://github.com/almafa64/minecraft-mod-hoster))
```ini
TOKEN = "<bot token>"
MC_CHANNEL = "(channel to send player/server changes)" # won't send updates if not set
APP_ID = "(application ID)" # won't register slash command if not set
GUILD_ID = "(id of server)" # registers slash command globally if not set
PORT = "(query port)" # if not set then default (25565) is used.
HOST = "(mc server ip/domain)" # if not set then default (127.0.0.1) is used.

# Don't need to set both path, prefer HOSTER_BRANCH_PATH if you have mod hoster 
HOSTER_BRANCH_PATH = "(path to hoster's branch folder which is used for the server)" # check new/deleted mods in mod hoster's branch folder (only works if server is on same machine and this code has read permission to that folder)
SERVER_MODS_PATH = "(path to server's mods folder)" # check new/deleted mods in server's mods folder (only works if server is on same machine and this code has read permission to that folder)
```