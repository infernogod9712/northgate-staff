# NorthGate Studios Staff Management

The staff management bot for NorthGate Studios. Handles staff promotions,
infractions, and staff reports.

It runs across two servers with different jobs:

| Server | What lives there |
| --- | --- |
| **Staff hub** (NorthGate Studios) | Staff Leadership role, promotion log, infraction log, locked HR report forum |
| **Main server** (NGC) | The staff report panel |

The bot is told which server is which with `/config server:hub` and
`/config server:main`. Hub settings are always read from the hub, whichever server
a command is run in, so leadership can promote and infract from either server and
everything still logs in the hub.

## Setup

1. `npm install`
2. Fill in `.env` with the bot token, client id, and both owner ids.
3. Turn on the **Server Members** and **Message Content** intents in the Discord
   Developer Portal, under Bot > Privileged Gateway Intents.
4. `node index.js`
5. Send `!sc` in any server the bot is in to register the slash commands. Only the
   two owner ids can run it. Global commands take up to about an hour to appear.
6. **In the staff hub:** `/config server:hub`, plus `staff_leadership`,
   `promote_channel`, `infract_channel` and `report_forum`. They can all go in the
   same command.
7. **In the main server:** `/config server:main` and `report_channel`, then
   `/reportembed` to post the panel.

A server only accepts its own settings. Trying to set a hub setting in the main
server is refused and says why, rather than being saved where nothing reads it.
For a single test server, run both `server:hub` and `server:main` in it.

Until both servers are marked, the bot keeps working the way it did before the
split, reading settings from whichever server a command runs in. That is what
lets an existing install update without its logs or reports stopping. The one
exception is Fire and Staff Blacklist, which refuse to remove anyone until a hub
is marked.

`npm run check` tests the two-server behaviour with fake Discord objects. It needs
no token and never touches `data/`.

## Commands

| Command | Who can run it | What it does |
| --- | --- | --- |
| `/promote` | Staff Leadership | Gives a rank role, logs it, DMs the member |
| `/infract` | Staff Leadership | Logs an infraction and DMs the member. Fire and Staff Blacklist also kick |
| `/reportembed` | Staff Leadership | Posts the staff report panel |
| `/hrpanel` | Administrators | Private snapshot of low performance and leave |
| `/config` | Bot owners only | Sets every role and channel the bot uses |
| `!sc` | Bot owners only | Registers the slash commands with Discord |

## HR panel

Shows who is at or below 3 stars on **Performance** and who is on **Leave of
Absence, Reduced Activity or Administrative Leave**, read from the NGC Employee
Database Google Sheet.

- An **auto-updating panel** in each server, edited in place every 30 seconds
- **`/hrpanel`** gives an Administrator a private snapshot that does not update

Setup:

1. The sheet is shared, as **Viewer**, with the service account
   `id-7modbot-679@modbot-497414.iam.gserviceaccount.com`.
2. Copy that service account's key file into the bot folder as
   **`credentials.json`**. On the Pi this is done by hand: the file is gitignored
   and must never go through GitHub.
3. `/config hr_panel_channel:#channel` in the staff hub, and again in the main
   server. Both must be staff-only channels. The bot refuses a channel @everyone
   can read, because the panel shows performance ratings.

The bot reads only four columns (nickname, Discord ID, Performance, Employment
Status), finds them by header name, and never requests Infractions or Notes.
Department header rows and blank rows are skipped. Someone listed in two
departments appears once, at their lowest rating. A rating of 0 shows as "not
rated yet". If a read fails, the panel keeps showing the last good data and says
so.

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
| `handlers/sheets.js` | Signs in to Google as the service account and reads the four roster columns |
| `handlers/roster.js` | Turns those columns into the low performance and leave lists |
| `handlers/hrpanel.js` | Builds the HR panel embed and keeps the panels updated |
| `commands/` | One file per slash command |

## Notes

- `.env` and `data/` are gitignored. Nothing with a token or a live setting goes
  to GitHub.
- The bot's role must sit ABOVE any rank role it hands out, or `/promote` fails
  with a missing permissions error.
- Filenames are lowercase. The Pi runs Linux and is case-sensitive about them,
  even though Windows is not.
