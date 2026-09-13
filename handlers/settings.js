// Everything an owner configures in Discord with /config.
//
// The bot runs in two servers at once, and they do different jobs:
//
//   main  the NGC community server. Holds the staff report panel.
//   hub   the NorthGate Studios staff hub. Holds the leadership role, both log
//         channels and the locked HR report forum.
//
// Which server is which is recorded explicitly with /config server:main and
// /config server:hub. It used to be guessed: the report forum was "whichever
// server had one set first", and every command read settings out of the server
// it happened to be run in. That meant a promotion run from the main server
// logged nowhere, and a Fire run from the main server kicked the person out of
// the whole community instead of the staff hub.
//
// File shape:
//   {
//     "servers": { "main": "<guildId>", "hub": "<guildId>" },
//     "guilds":  { "<guildId>": { ...that server's own settings } }
//   }
//
// One server may be both main and hub. That is how a single test server works.
const fs = require('fs');
const path = require('path');

// Tests point NGS_DATA_DIR at a scratch folder so they never touch the real
// settings file.
const DATA_DIR = process.env.NGS_DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'settings.json');

// Which settings belong to which server. /config uses these to refuse a setting
// in the wrong server instead of quietly saving it where nothing will read it.
const HUB_KEYS = ['staffLeadershipRole', 'promoteChannel', 'infractChannel', 'staffReportForum'];
const MAIN_KEYS = ['staffReportChannel'];

const SNOWFLAKE = /^\d{17,20}$/;

function blank() {
  return { servers: { main: null, hub: null }, guilds: {} };
}

// Older installs saved { "<guildId>": {...} } with no servers section. Moving that
// under "guilds" keeps every setting anyone already made. The servers are left
// unset on purpose: guessing which old server is the hub is exactly the bug this
// file exists to remove, so /config says what still needs setting instead.
function normalise(raw) {
  if (!raw || typeof raw !== 'object') return { data: blank(), migrated: false };

  if (raw.guilds && typeof raw.guilds === 'object') {
    return {
      data: {
        servers: { main: raw.servers?.main || null, hub: raw.servers?.hub || null },
        guilds: raw.guilds,
      },
      migrated: false,
    };
  }

  const data = blank();
  let migrated = false;
  for (const [key, value] of Object.entries(raw)) {
    if (SNOWFLAKE.test(key) && value && typeof value === 'object') {
      data.guilds[key] = value;
      migrated = true;
    }
  }
  return { data, migrated };
}

function readAll() {
  let raw = null;
  try {
    raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (err) {
    // A missing file is a fresh install. A file that exists but will not parse is
    // somebody's real setup, and overwriting it would destroy it, so say so.
    if (err.code !== 'ENOENT') console.error('[settings] could not read settings.json:', err.message);
    return blank();
  }
  const { data, migrated } = normalise(raw);
  if (migrated) {
    writeAll(data);
    console.log('[settings] moved existing server settings into the two-server format.');
  }
  return data;
}

function writeAll(obj) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(obj, null, 2));
}

// One server's own settings. Always an object, never undefined.
function getSettings(guildId) {
  return readAll().guilds[guildId] || {};
}

// Merge new values into one server's settings. Only the keys passed are touched.
function updateSettings(guildId, patch) {
  const all = readAll();
  all.guilds[guildId] = { ...(all.guilds[guildId] || {}), ...patch };
  writeAll(all);
  return all.guilds[guildId];
}

function getServers() {
  return { ...readAll().servers };
}

// role is 'main' or 'hub'.
function setServer(role, guildId) {
  if (role !== 'main' && role !== 'hub') throw new Error(`unknown server role: ${role}`);
  const all = readAll();
  all.servers[role] = guildId;
  writeAll(all);
  return { ...all.servers };
}

// What this server is for: ['main'], ['hub'], ['main', 'hub'] or [].
function serverRoles(guildId) {
  const { main, hub } = readAll().servers;
  const roles = [];
  if (main === guildId) roles.push('main');
  if (hub === guildId) roles.push('hub');
  return roles;
}

// ---------------------------------------------------------------------------
// Before the servers are marked
// ---------------------------------------------------------------------------
//
// An install from before the two-server split has settings but no hub or main
// marked. Until an owner marks them, everything reads the way it always did:
// settings come from the server a command runs in, and the report forum is the
// first one found.
//
// That fallback is what makes this safe to push to the live bot. Without it the
// Pi would restart onto this code with no servers marked, and promotions,
// infractions and staff reports would all stop logging at once. They would stay
// stopped until an owner ran /config in both servers, and /config cannot even
// offer the server option until !sc has re-registered the commands, which
// Discord can take up to an hour to show.
//
// Removing somebody is the one thing that does NOT fall back. /infract refuses
// to kick until a hub is marked, because the old behaviour there was the bug.
let warnedUnmarked = false;
function warnIfUnmarked(servers) {
  if (warnedUnmarked || (servers.hub && servers.main)) return;
  warnedUnmarked = true;
  console.warn('[settings] hub and main server are not both marked yet. Working the old per-server way until an owner runs /config server:hub in the staff hub and /config server:main in the main server.');
}

// The hub's settings. Pass the server the command is running in, so an install
// with no hub marked yet keeps reading that server like it always did.
function hubSettings(fallbackGuildId) {
  const { servers } = readAll();
  warnIfUnmarked(servers);
  if (servers.hub) return getSettings(servers.hub);
  return fallbackGuildId ? getSettings(fallbackGuildId) : {};
}

function mainSettings(fallbackGuildId) {
  const { servers } = readAll();
  warnIfUnmarked(servers);
  if (servers.main) return getSettings(servers.main);
  return fallbackGuildId ? getSettings(fallbackGuildId) : {};
}

// The HR report forum. The button lives in the main server and the forum lives
// in the hub, so once a hub is marked this reads the hub and nothing else. Before
// that it takes the first forum set anywhere, which is how it always worked, and
// which is exactly why marking the hub matters once the bot is in a third server
// such as a test server.
function findReportForum() {
  const all = readAll();
  warnIfUnmarked(all.servers);
  if (all.servers.hub) return (all.guilds[all.servers.hub] || {}).staffReportForum || null;
  for (const g of Object.values(all.guilds)) {
    if (g.staffReportForum) return g.staffReportForum;
  }
  return null;
}

module.exports = {
  HUB_KEYS,
  MAIN_KEYS,
  getSettings,
  updateSettings,
  getServers,
  setServer,
  serverRoles,
  hubSettings,
  mainSettings,
  findReportForum,
};
