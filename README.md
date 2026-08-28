# NorthGate Studios Staff Management

The staff management bot for NorthGate Studios. Handles staff promotions,
infractions, and staff reports.

It runs across two servers: the NGC main server and the NorthGate Studios staff
hub. Settings are saved per server, so `/config` is run once in each.

## Setup

1. `npm install`
2. Fill in `.env` with the bot token, client id, and both owner ids.
3. Turn on the **Server Members** and **Message Content** intents in the Discord
   Developer Portal, under Bot > Privileged Gateway Intents.
4. `node index.js`
5. Send `!sc` in any server the bot is in to register the slash commands. Only the
   two owner ids can run it. Global commands take up to about an hour to appear.
6. Run `/config` in the staff hub to set the leadership role, the promotion and
   infraction log channels, and the HR report forum.
7. Run `/config` in the main server to set the report panel channel, then
   `/reportembed` to post the panel.

## Commands

| Command | Who can run it | What it does |
| --- | --- | --- |
| `/promote` | Staff Leadership | Gives a rank role, logs it, DMs the member |
| `/infract` | Staff Leadership | Logs an infraction and DMs the member. Fire and Staff Blacklist also kick |
| `/reportembed` | Staff Leadership | Posts the staff report panel |
| `/config` | Bot owners only | Sets every role and channel the bot uses |
| `!sc` | Bot owners only | Registers the slash commands with Discord |

## How staff reports work

1. Someone presses the button on the panel in the main server.
2. A form asks who they are reporting and what happened.
3. The bot opens a post in the locked HR forum in the staff hub.
4. The reporter's name is on the post. Reports are **not anonymous**, so HR can
   follow up with them.

The forum is locked with Discord channel permissions, not by the bot. Give the HR
role View Channel and take it away from everyone else.

## Files

| File | What it does |
| --- | --- |
| `index.js` | Starts the bot, loads commands, routes interactions, handles `!sc` |
| `config.js` | Reads the secrets out of `.env` and checks they are filled in |
| `git-sync.js` | On the Pi, watches GitHub and pulls new commits by itself |
| `handlers/settings.js` | Per-server settings saved to `data/settings.json` |
| `handlers/permissions.js` | Owner and staff leadership checks |
| `handlers/embeds.js` | Shared colour palette and embed templates |
| `handlers/forms.js` | The modal (pop-up form) definitions |
| `handlers/interactions.js` | Button clicks and form submits |
| `commands/` | One file per slash command |

## Notes

- `.env` and `data/` are gitignored. Nothing with a token or a live setting goes
  to GitHub.
- The bot's role must sit ABOVE any rank role it hands out, or `/promote` fails
  with a missing permissions error.
- Filenames are lowercase. The Pi runs Linux and is case-sensitive about them,
  even though Windows is not.
