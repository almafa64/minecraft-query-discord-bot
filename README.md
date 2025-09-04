# Minecraft query discord bot

A random dc bot I wrote for my server, so my friends can know who is in game or if the server is even up.

## Environment settings
(use .env file)
```ini
TOKEN = "<bot token>"
MC_CHANNEL = "(channel to send player/server changes)" # won't send updates if not set
APP_ID = "(application ID)" # won't register slash command if not set
GUILD_ID = "(id of server)" # registers slash command globally if not set
PORT = "(query port)" # if not set then default (25565) is used.
HOST = "(mc server ip/domain)" # if not set then default (127.0.0.1) is used.
```