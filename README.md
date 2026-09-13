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
   `promote_channel`, `infract_channel`, `report_forum` and `loa_channel` (a forum). They can
   all go in the same command.
7. **In the main server:** `/config server:main`, plus `report_channel`, `hr_role`
   and `log_channel`, then `/reportembed` to post the panel.
8. **In both:** `/config hr_panel_channel:#channel` for the auto-updating HR panel.

A server only accepts its own settings. Trying to set a hub setting in the main
server is refused and says why, rather than being saved where nothing reads it.
For a single test server, run both `server:hub` and `server:main` in it.

Until both servers are marked, the bot keeps working the way it did before the
split, reading settings from whichever server a command runs in. That is what
lets an existing install update without its logs or reports stopping. The one
exception is `/fire`, which refuses to do anything until a hub is marked, because
removing people from the hub is part of what it does.

`npm run check` runs `tools/check.js` (the two-server behaviour, with fake Discord
objects) and `tools/check-hr.js` (every roster change, against a simulated sheet).
It needs no token and no network, and never touches `data/`.

## Commands

| Command | Who can run it | What it does |
| --- | --- | --- |
| `/hire` | HR | Adds them to the roster under a department, gives the rank role, welcomes them with the staff handbook |
| `/promote` | Staff Leadership | Sets their roster title (`sheet_rank`), gives the rank role, logs it, DMs them |
| `/fire` | HR | Moves them to the Former Staff Roster as Retired or Terminated, and removes them from the staff hub |
| `/suspend`, `/unsuspend` | HR | Sets their roster status to Suspended, or back to Active |
| `/loalog` | HR | Starts a Leave of Absence or Reduced Activity with an end date, or ends one early. They return to Active by themselves |
| `/infract` | HR | Logs an infraction, DMs them, and records it under Warnings or Infractions on the roster |
| `/addnote` | HR | Adds a dated, signed note to their roster Notes. Posts nothing anywhere else |
| `/setperformancerating`, `/setactivityrating` | HR | Sets a 0 to 5 star rating on the roster |
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

1. The sheet is shared, as **Editor**, with the service account
   `id-7modbot-679@modbot-497414.iam.gserviceaccount.com`. The panel only reads,
   but the HR commands below write to the same sheet.
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

## Editing the roster

`/hire`, `/fire`, `/suspend`, `/unsuspend`, `/loalog`, `/infract`, `/addnote` and
the two rating commands change the Employee Database directly, so HR never has to
edit the sheet by hand. "HR" in the table above means the HR role in the main
server, Staff Leadership in the hub, or an Administrator.

The service account must be an **Editor** on the sheet. How the bot writes, and
why (see `handlers/rosterWriter.js`):

- It re-reads the roster before every change and finds people by Discord ID, never
  by a remembered row number
- One command is one all-or-nothing change, so a `/fire` can never leave someone on
  both rosters or on neither
- Commands wait their turn, so two HR members acting at once cannot overwrite each
  other
- Dropdown values are read from the sheet's own dropdown, because Google silently
  accepts a near miss like "Active" for "Active "
- Discord IDs are written as text, since a 19-digit number cannot be stored exactly

Someone listed in two departments has two rows. Statuses, notes, warnings and
infractions apply to both. Ratings and the roster title apply to one, so those
commands ask for the `department` when it is needed. `/fire` moves every row.

**Leave that ends by itself.** `/loalog` takes the last day away (`2026-10-01`) or a
length (`7d`, `2w`). A check every minute puts them back to Active once it passes,
remembered in `data/leave.json` across restarts. It only undoes its own change: if
HR has set them to something else in the meantime, such as Suspended, it is left
alone and the leave log says so. The leave log is a forum: each leave gets its own
post, and a new end date, ending it early, or the bot ending it are all added inside
that same post.

**Command log.** Every command used in the hub or the main server is posted to the
main server's `log_channel`: the command, who ran it, where, and when. Never what
was typed into it.

**Testing against a copy.** Set `ROSTER_SHEET_ID` in `.env` to a copy of the sheet
(shared with the service account as Editor) and restart. Remove it to go back to
the real one.

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
| `handlers/rosterWriter.js` | Every change the bot makes to the Employee Database |
| `handlers/leave.js` | Leave end dates, and returning people to Active when they pass |
| `handlers/departments.js` | Maps department names in Discord to the roster's section headers |
| `handlers/hrcommand.js` | The HR permission check and plain-English roster errors |
| `handlers/hrnotices.js` | The welcome message and staff action embeds |
| `handlers/commandlog.js` | The "Command Used" log |
| `tools/check-hr.js` | Tests every roster write against a simulated sheet |
| `commands/` | One file per slash command |

## Notes

- `.env` and `data/` are gitignored. Nothing with a token or a live setting goes
  to GitHub.
- The bot's role must sit ABOVE any rank role it hands out, or `/promote` fails
  with a missing permissions error.
- Filenames are lowercase. The Pi runs Linux and is case-sensitive about them,
  even though Windows is not.
