// newhires.js
// The New Hire period. /hire puts someone on the roster as New Hire, this file
// remembers when, and a check every hour sets them to Active once two weeks
// have passed.
//
// It only ever undoes what it did, the same rule as leave.js. At the two week
// mark only rows that still say New Hire are changed. If HR has changed their
// status in the meantime (Active early, Suspended, on leave, anything), that
// change stands and the bot just forgets about them.
//
// Remembered in data/newhires.json, so a restart on the Pi does not reset
// anyone's two weeks. data/ is gitignored.

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.NGS_DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'newhires.json');

const DAY = 86_400_000;
const NEW_HIRE_DAYS = 14;

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('[newhires] could not read newhires.json:', err.message);
    return {};
  }
}

function writeStore(store) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(store, null, 2));
}

function createNewHireManager({ writer, now = () => Date.now(), log = console }) {
  // Hiring someone again (into a second department, or after a firing) starts
  // their two weeks over from the newest hire.
  function track({ discordId, department, by }) {
    const store = readStore();
    const hiredAt = now();
    store[discordId] = { hiredAt, activeAt: hiredAt + NEW_HIRE_DAYS * DAY, department, by };
    writeStore(store);
    return store[discordId];
  }

  let checking = false;
  async function checkDue() {
    if (checking) return;
    checking = true;
    try {
      for (const [discordId, entry] of Object.entries(readStore())) {
        if (entry.activeAt > now()) continue;

        let outcome = 'activated';
        try {
          await writer.activateNewHire({ discordId });
        } catch (err) {
          if (err.code === 'wrong_status' || err.code === 'not_on_roster') {
            outcome = err.code;
          } else {
            // Google down, rate limited, and so on. Try again at the next check.
            log.warn(`[newhires] could not end a New Hire period yet, will retry: ${err.message}`);
            continue;
          }
        }

        const store = readStore();
        delete store[discordId];
        writeStore(store);
        log.log(
          outcome === 'activated'
            ? `[newhires] ${discordId} finished their two weeks and is now Active`
            : `[newhires] ${discordId} finished their two weeks but was left alone (${outcome === 'wrong_status' ? 'HR already changed their status' : 'no longer on the roster'})`
        );
      }
    } finally {
      checking = false;
    }
  }

  let timer = null;
  function start(intervalMs = 60 * 60_000) {
    if (timer) return;
    checkDue();
    timer = setInterval(checkDue, intervalMs);
  }
  function stop() {
    clearInterval(timer);
    timer = null;
  }

  return { track, checkDue, start, stop, list: readStore };
}

let manager = null;

function getNewHireManager() {
  if (!manager) {
    const { getWriter } = require('./rosterWriter');
    manager = createNewHireManager({ writer: getWriter() });
  }
  return manager;
}

function setNewHireManager(replacement) {
  manager = replacement;
}

function startNewHireChecks() {
  getNewHireManager().start();
}

module.exports = { createNewHireManager, getNewHireManager, setNewHireManager, startNewHireChecks, NEW_HIRE_DAYS };
