// leave.js
// Leave of Absence and Reduced Activity, with an end date the bot enforces.
//
// HR asked never to have to edit the sheet by hand. So /loalog sets the status,
// this file remembers when the leave ends, and a check every minute puts the
// person back to Active once that date has passed. The same command can also end
// a leave early.
//
// It only ever undoes what it did. When a leave ends, the status goes back to
// Active only if the sheet still shows that same leave. If HR has changed it in
// the meantime, to Suspended for example, it is left alone and the log says so.
// A bot quietly reactivating a suspended staff member because an old leave date
// passed would be the worst thing this file could do.
//
// Remembered in data/leave.json, so a restart on the Pi does not forget anyone's
// return date. Each leave also remembers its post in the leave forum, so later
// updates about it land in the same post. data/ is gitignored.

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.NGS_DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'leave.json');

const LEAVE_STATUSES = ['Leave of Absence', 'Reduced Activity'];
const DAY = 86_400_000;
const MAX_DAYS = 366;

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('[leave] could not read leave.json:', err.message);
    return {};
  }
}

function writeStore(store) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(store, null, 2));
}

// "2026-10-01" means they are away for all of October 1st, so they come back at
// the start of October 2nd, UTC. "7d" and "2w" count from right now. Written
// dates use year-month-day on purpose: 01/10/2026 means January to one staff
// member and October to another.
function parseUntil(input, now = Date.now()) {
  const value = String(input ?? '').trim().toLowerCase();
  const date = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const span = value.match(/^(\d{1,3})\s*([dw])$/);

  let ms;
  if (date) {
    const y = Number(date[1]);
    const m = Number(date[2]);
    const d = Number(date[3]);
    const start = Date.UTC(y, m - 1, d);
    const check = new Date(start);
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
      return { error: 'that date does not exist' };
    }
    ms = start + DAY;
  } else if (span) {
    ms = now + Number(span[1]) * (span[2] === 'w' ? 7 : 1) * DAY;
  } else {
    return { error: 'use a date like 2026-10-01, or a length like 7d or 2w' };
  }

  if (ms <= now) return { error: 'that date has already passed' };
  if (ms - now > MAX_DAYS * DAY) return { error: 'a leave can be at most a year long' };
  return { ms };
}

function createLeaveManager({ writer, now = () => Date.now(), log = console, onEnded = async () => {} }) {
  async function begin({ discordId, status, until, reason, by }) {
    try {
      await writer.setStatus({ discordId, status });
    } catch (err) {
      // Already on that leave: just move the end date.
      if (err.code !== 'unchanged') throw err;
    }
    const store = readStore();
    const previous = store[discordId] || null;
    store[discordId] = {
      status,
      until,
      reason: reason || null,
      setBy: by,
      setAt: now(),
      // Keep the existing forum post, so a new end date is added to the same leave.
      threadId: previous?.threadId || null,
    };
    writeStore(store);
    return { previous };
  }

  // Remember which forum post belongs to this leave.
  function attachThread(discordId, threadId) {
    const store = readStore();
    if (!store[discordId]) return;
    store[discordId].threadId = threadId;
    writeStore(store);
  }

  async function end({ discordId }) {
    await writer.setStatus({ discordId, status: 'Active', onlyFrom: LEAVE_STATUSES });
    const store = readStore();
    const entry = store[discordId] || null;
    delete store[discordId];
    writeStore(store);
    return { entry };
  }

  let checking = false;
  async function checkDue() {
    if (checking) return;
    checking = true;
    try {
      for (const [discordId, entry] of Object.entries(readStore())) {
        if (entry.until > now()) continue;

        let outcome = 'returned';
        try {
          await writer.setStatus({ discordId, status: 'Active', onlyFrom: [entry.status] });
        } catch (err) {
          if (err.code === 'wrong_status' || err.code === 'not_on_roster') {
            outcome = err.code;
          } else {
            // Google down, rate limited, and so on. Try again at the next check.
            log.warn(`[leave] could not end a leave yet, will retry: ${err.message}`);
            continue;
          }
        }

        const store = readStore();
        delete store[discordId];
        writeStore(store);
        try {
          await onEnded({ discordId, entry, outcome });
        } catch (err) {
          log.warn(`[leave] could not post that a leave ended: ${err.message}`);
        }
      }
    } finally {
      checking = false;
    }
  }

  let timer = null;
  function start(intervalMs = 60_000) {
    if (timer) return;
    checkDue();
    timer = setInterval(checkDue, intervalMs);
  }
  function stop() {
    clearInterval(timer);
    timer = null;
  }

  return { begin, attachThread, end, checkDue, start, stop, list: readStore };
}

let manager = null;

function getLeaveManager(client) {
  if (!manager) {
    const { getWriter } = require('./rosterWriter');
    const { leaveEnded } = require('./hrnotices');
    manager = createLeaveManager({ writer: getWriter(), onEnded: (event) => leaveEnded(client, event) });
  }
  return manager;
}

function setLeaveManager(replacement) {
  manager = replacement;
}

function startLeaveChecks(client) {
  getLeaveManager(client).start();
}

module.exports = { createLeaveManager, parseUntil, getLeaveManager, setLeaveManager, startLeaveChecks, LEAVE_STATUSES };
