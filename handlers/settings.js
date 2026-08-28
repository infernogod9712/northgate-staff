// Everything an admin configures in Discord with /config, kept per guild so the
// bot can run in the main server and the staff hub at the same time.
//
// Shape: { "<guildId>": {
//   // Staff hub (NorthGate Studios)
//   staffLeadershipRole, promoteChannel, infractChannel, staffReportForum,
//   // Main server (NGC)
//   staffReportChannel
// } }
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'settings.json');

function readAll() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeAll(obj) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(obj, null, 2));
}

// Read one guild's settings. Always returns an object, never undefined, so
// callers can do `getSettings(id).promoteChannel` without a null check.
function getSettings(guildId) {
  return readAll()[guildId] || {};
}

// Merge new values into one guild's settings and save. Only the keys you pass
// are touched, so /config can set one thing at a time.
function updateSettings(guildId, patch) {
  const all = readAll();
  all[guildId] = { ...(all[guildId] || {}), ...patch };
  writeAll(all);
  return all[guildId];
}

// The HR staff-report forum id, found across every guild the bot knows about. The
// report button lives in the main server but the forum lives in the staff hub,
// which is a different guild, so the button handler cannot read it out of its own
// guild settings and looks it up here instead. Assumes one staff hub.
function findReportForum() {
  for (const g of Object.values(readAll())) {
    if (g.staffReportForum) return g.staffReportForum;
  }
  return null;
}

module.exports = { getSettings, updateSettings, findReportForum };
