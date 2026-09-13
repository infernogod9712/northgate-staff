// tools/check-hr.js
// Tests every command that writes to the Employee Database, against a simulated
// Google Sheet held in memory.
//
//   npm run check      (runs tools/check.js, then this)
//
// The simulated sheet copies the real one's shape, measured on 2026-09-13: two
// Sheets Tables with the same 11 columns, a status dropdown whose options have
// trailing spaces and "Leave of Absense" spelled that way, department header
// rows, placeholder blank rows with empty star ratings, and one person listed in
// two departments.
//
// It deliberately behaves like Google in the places the bot has to get right:
//   - a row inserted INSIDE a table grows it; one inserted at its bottom edge
//     does not, so a row landing outside the table fails a test
//   - batchUpdate is all-or-nothing
// Nothing here talks to the network or touches data/.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ngs-check-hr-'));
process.env.NGS_DATA_DIR = DATA;
process.env.DOTENV_CONFIG_QUIET = 'true';
process.env.DISCORD_TOKEN = 'test-token';
process.env.CLIENT_ID = '';
process.env.OWNER_ID_1 = '100000000000000001';
process.env.OWNER_ID_2 = '';
process.env.GOOGLE_CREDENTIALS_FILE = path.join(DATA, 'no-credentials-here.json');

const ROOT = path.join(__dirname, '..');
const { MessageFlags } = require('discord.js');

let failures = 0;
async function check(label, fn) {
  try {
    const result = await fn();
    if (result === true) console.log(`  ok    ${label}`);
    else { failures += 1; console.log(`  FAIL  ${label}  <- ${result}`); }
  } catch (err) {
    failures += 1;
    console.log(`  FAIL  ${label}  <- threw: ${err.stack.split('\n').slice(0, 3).join(' | ')}`);
  }
}
const section = (t) => console.log(`\n${t}\n${'-'.repeat(70)}`);

// ---------------------------------------------------------------------------
// A generated service account key, so the real sign-in code runs unchanged
// ---------------------------------------------------------------------------
const { privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const KEY_PATH = path.join(DATA, 'test-credentials.json');
fs.writeFileSync(KEY_PATH, JSON.stringify({ type: 'service_account', client_email: 'hr@test.iam.gserviceaccount.com', private_key: privateKey }));

// ---------------------------------------------------------------------------
// The simulated Employee Database
// ---------------------------------------------------------------------------
const OFFICIAL = 'OFFICAL STAFF ROSTER';
const FORMER = 'FORMER STAFF ROSTER';
const COLUMNS = ['nickname', 'Discord ID', 'Roblox ID', 'Roles ', 'Performance', 'Activity', 'Employment Status', 'DATE HIRED', 'Warnings', 'Infractions', 'Notes'];
const OFFICIAL_STATUS = ['Active ', 'Reduced Activity ', 'Leave of Absense', 'Suspended', 'Terminated', 'Administrative Leave'];
const FORMER_STATUS = ['Retired', 'Terminated'];

const ID = {
  A: '111111111111111111', // in two departments
  B: '222222222222222222',
  C: '333333333333333333', // suspended
  D: '444444444444444444', // on leave
  E: '555555555555555555', // the last row of the whole table
  F: '666666666666666666', // already on the Former roster
  NEW: '777777777777777777',
  NEW2: '888888888888888888',
  STRANGER: '999999999999999999',
};

const s = (v) => ({ userEnteredValue: { stringValue: v } });
const n = (v) => ({ userEnteredValue: { numberValue: v } });
const none = () => ({});
const sectionRow = (name) => [s(name), ...Array.from({ length: 10 }, none)];
const blankRow = () => [none(), none(), none(), none(), n(0), n(0), none(), none(), none(), none(), none()];
const person = ({ nick, id, roles = 'Staff', perf = 0, act = 0, status, warnings = 'None', infractions = 'None', notes = '' }) => [
  s(nick), s(id), s('1000'), s(roles), n(perf), n(act), s(status), s('January 1, 2026'), s(warnings), s(infractions), notes ? s(notes) : none(),
];

function makeSheet() {
  const header = COLUMNS.map((c) => s(c));
  const model = {
    [OFFICIAL]: {
      sheetId: 0,
      table: { name: 'Table1', startRowIndex: 1, endRowIndex: 15 },
      options: OFFICIAL_STATUS,
      rows: [
        [s('NGC logo')],
        header,
        sectionRow('Studio Executive Ownership'),
        person({ nick: 'Alpha', id: ID.A, roles: 'Owner', perf: 5 }),
        sectionRow('COMMUNITY OUTREACH DEPARTMENT'),
        person({ nick: 'Bravo', id: ID.B, perf: 3, status: 'Active ' }),
        person({ nick: 'Charlie', id: ID.C, perf: 1, status: 'Suspended' }),
        sectionRow('STUDIO DEVELOPMENT TEAM'),
        person({ nick: 'Alpha', id: ID.A, roles: 'Developer', perf: 2, status: 'Active ' }),
        sectionRow('PUBLIC RELATIONS TEAM'),
        person({ nick: 'Delta', id: ID.D, status: 'Leave of Absense' }),
        blankRow(),
        blankRow(),
        sectionRow('Human Resources & Staff Operations'),
        person({ nick: 'Echo', id: ID.E, status: 'Reduced Activity ' }),
      ],
    },
    [FORMER]: {
      sheetId: 564398058,
      table: { name: 'Table1_2', startRowIndex: 1, endRowIndex: 5 },
      options: FORMER_STATUS,
      rows: [
        [s('NGC logo')],
        header,
        person({ nick: 'Foxtrot', id: ID.F, status: 'Terminated' }),
        blankRow(),
        blankRow(),
      ],
    },
  };
  // The first Alpha row's status, set here so the literal stays readable above.
  model[OFFICIAL].rows[3][6] = s('Active ');

  const calls = { batch: 0, gets: 0 };
  let failNextWrite = null;

  const byId = (sheetId) => Object.entries(model).find(([, t]) => t.sheetId === sheetId);
  const shown = (cell) => {
    const v = cell?.userEnteredValue;
    if (!v) return undefined;
    if (v.stringValue !== undefined) return v.stringValue;
    if (v.numberValue !== undefined) return String(v.numberValue);
    return undefined;
  };
  const reply = (code, body) => ({ ok: code >= 200 && code < 300, status: code, json: async () => body });

  function apply(state, request) {
    if (request.insertDimension) {
      const { range } = request.insertDimension;
      const [, tab] = Object.entries(state).find(([, t]) => t.sheetId === range.sheetId);
      const count = range.endIndex - range.startIndex;
      tab.rows.splice(range.startIndex, 0, ...Array.from({ length: count }, blankRow));
      const t = tab.table;
      if (range.startIndex > t.startRowIndex && range.startIndex < t.endRowIndex) t.endRowIndex += count;
      else if (range.startIndex <= t.startRowIndex) { t.startRowIndex += count; t.endRowIndex += count; }
      return;
    }
    if (request.deleteDimension) {
      const { range } = request.deleteDimension;
      const [, tab] = Object.entries(state).find(([, t]) => t.sheetId === range.sheetId);
      const count = range.endIndex - range.startIndex;
      tab.rows.splice(range.startIndex, count);
      const t = tab.table;
      if (range.startIndex > t.startRowIndex && range.startIndex < t.endRowIndex) t.endRowIndex -= count;
      else if (range.startIndex <= t.startRowIndex) { t.startRowIndex -= count; t.endRowIndex -= count; }
      return;
    }
    if (request.updateCells) {
      const { rows, start } = request.updateCells;
      const [, tab] = Object.entries(state).find(([, t]) => t.sheetId === start.sheetId);
      rows.forEach((r, ri) => {
        const rowIndex = start.rowIndex + ri;
        while (tab.rows.length <= rowIndex) tab.rows.push([]);
        r.values.forEach((cell, ci) => {
          tab.rows[rowIndex][start.columnIndex + ci] = cell.userEnteredValue ? { userEnteredValue: { ...cell.userEnteredValue } } : {};
        });
      });
      return;
    }
    throw new Error(`the simulated sheet does not support ${Object.keys(request)[0]}`);
  }

  async function fetchImpl(url, init = {}) {
    const text = decodeURIComponent(String(url));
    if (text.startsWith('https://oauth2.googleapis.com/token')) return reply(200, { access_token: 'sim', expires_in: 3600 });

    if (init.method === 'POST' && text.endsWith(':batchUpdate')) {
      if (failNextWrite) {
        const code = failNextWrite;
        failNextWrite = null;
        return reply(code, { error: { message: 'simulated failure' } });
      }
      const draft = JSON.parse(JSON.stringify(model));
      const { requests } = JSON.parse(init.body);
      try {
        requests.forEach((r) => apply(draft, r));
      } catch (err) {
        return reply(400, { error: { message: err.message } });
      }
      for (const key of Object.keys(model)) model[key] = draft[key];
      calls.batch += 1;
      return reply(200, {});
    }

    calls.gets += 1;
    if (text.includes('fields=sheets(properties')) {
      return reply(200, {
        sheets: Object.entries(model).map(([title, t]) => ({
          properties: { sheetId: t.sheetId, title },
          tables: [{
            name: t.table.name,
            range: { startRowIndex: t.table.startRowIndex, endRowIndex: t.table.endRowIndex, startColumnIndex: 0, endColumnIndex: 11 },
            columnProperties: COLUMNS.map((name, i) => ({
              columnIndex: i,
              columnName: name,
              ...(i === 6 ? { dataValidationRule: { condition: { values: t.options.map((v) => ({ userEnteredValue: v })) } } } : {}),
            })),
          }],
        })),
      });
    }

    const grid = text.match(/ranges='(.+)'!([A-Z]+)(\d+):([A-Z]+)(\d+)&includeGridData=true/);
    if (grid) {
      const title = grid[1].replace(/''/g, "'");
      const tab = model[title];
      if (!tab) return reply(404, {});
      const from = Number(grid[3]);
      const to = Number(grid[5]);
      const rowData = [];
      for (let r = from; r <= to; r += 1) {
        const cells = tab.rows[r - 1] || [];
        rowData.push({ values: cells.slice(0, 11).map((c) => (c?.userEnteredValue ? { userEnteredValue: c.userEnteredValue, formattedValue: shown(c) } : {})) });
      }
      return reply(200, { sheets: [{ data: [{ rowData }] }] });
    }
    return reply(400, { error: { message: `unexpected request ${text}` } });
  }

  // Test-side reading, independent of the writer's own code.
  const value = (cell) => shown(cell) ?? '';
  function peopleIn(title) {
    const tab = model[title];
    const out = [];
    let department = null;
    for (let r = tab.table.startRowIndex + 1; r < tab.table.endRowIndex; r += 1) {
      const cells = tab.rows[r] || [];
      const nick = value(cells[0]).trim();
      const id = value(cells[1]).trim();
      const status = value(cells[6]);
      if (!nick && !id) continue;
      if (!status.trim()) { department = nick; continue; }
      out.push({ row: r + 1, nick, id, status, department, roles: value(cells[3]), perf: cells[4]?.userEnteredValue, act: cells[5]?.userEnteredValue, idCell: cells[1]?.userEnteredValue, warnings: value(cells[8]), infractions: value(cells[9]), notes: value(cells[10]) });
    }
    return out;
  }
  const rowsFor = (title, id) => peopleIn(title).filter((p) => p.id === id);
  const snapshot = () => JSON.stringify(model);

  return {
    model, calls, fetchImpl, peopleIn, rowsFor, snapshot,
    failNextWrite: (code) => { failNextWrite = code; },
  };
}

function makeWriter(sheet, extra = {}) {
  const { createRosterWriter } = require(path.join(ROOT, 'handlers', 'rosterWriter'));
  return createRosterWriter({
    credentialsFile: KEY_PATH,
    sheetId: 'simulated',
    officialTab: OFFICIAL,
    formerTab: FORMER,
    fetchImpl: sheet.fetchImpl,
    ...extra,
  });
}

async function rejects(promise) {
  try {
    await promise;
    return null;
  } catch (err) {
    return err;
  }
}

// ---------------------------------------------------------------------------
// Fake Discord
// ---------------------------------------------------------------------------
const OWNER = '100000000000000001';
const MAIN = '200000000000000001';
const HUB = '300000000000000001';
const OTHER = '400000000000000001';
const LEAD = '500000000000000001';
const HR = '500000000000000002';
const RANK = '500000000000000003';
const CH = { infract: '600000000000000001', loa: '600000000000000002', log: '600000000000000003', here: '600000000000000004' };

function fakeUser(id, username = `user${id.slice(-3)}`) {
  const u = { id, username, bot: false, globalName: null, dms: [], displayAvatarURL: () => null };
  u.send = async (payload) => { u.dms.push(payload); };
  return u;
}

function fakeChannel(client, id) {
  const c = { id, sent: [] };
  c.send = async (payload) => { c.sent.push(payload); return { id: `9${c.sent.length}` }; };
  if (client) client._channels.set(id, c);
  return c;
}

// A forum channel: it has no send() of its own, only posts, and each post is a
// thread that can be sent to.
function fakeForum(client, id) {
  const f = { id, posts: [] };
  f.threads = {
    create: async ({ name, message }) => {
      const thread = { id: `8${String(f.posts.length + 1).padStart(17, '0')}`, name, messages: [message] };
      thread.send = async (payload) => { thread.messages.push(payload); return {}; };
      f.posts.push(thread);
      client._channels.set(thread.id, thread);
      return thread;
    },
  };
  client._channels.set(id, f);
  return f;
}

function fakeClient() {
  const channels = new Map();
  const users = new Map();
  return {
    guilds: { cache: new Map() },
    channels: { fetch: async (id) => { if (!channels.has(id)) throw new Error('Unknown Channel'); return channels.get(id); } },
    users: { fetch: async (id) => { if (!users.has(id)) throw new Error('Unknown User'); return users.get(id); } },
    _channels: channels,
    _users: users,
  };
}

function fakeGuild(id, client, name) {
  const g = { id, name, client, kicked: [], members: { store: new Map() } };
  g.members.fetch = async (userId) => {
    if (!g.members.store.has(userId)) throw new Error('Unknown Member');
    return g.members.store.get(userId);
  };
  client.guilds.cache.set(id, g);
  return g;
}

function join(guild, user, roleIds = [], admin = false) {
  guild.client._users.set(user.id, user);
  const m = { id: user.id, user, guild, client: guild.client, displayName: user.username, permissions: { has: () => admin }, roles: { cache: new Set(roleIds), added: [] } };
  m.roles.add = async (roleId) => { m.roles.cache.add(roleId); m.roles.added.push(roleId); };
  m.kick = async () => { guild.kicked.push(user.id); guild.members.store.delete(user.id); };
  guild.members.store.set(user.id, m);
  return m;
}

function fakeInteraction({ client, guild, member, user, options = {}, channel = null }) {
  const i = { client, guild, member, user, channel, replies: [], deferOpts: null };
  const get = (name) => (options[name] === undefined ? null : options[name]);
  i.options = { getString: get, getRole: get, getUser: get, getInteger: get, getChannel: get };
  i.deferReply = async (opts) => { i.deferOpts = opts; };
  i.editReply = async (p) => { i.replies.push(p); };
  i.reply = async (p) => { i.replies.push(p); };
  return i;
}

const said = (i) => i.replies
  .map((r) => (typeof r === 'string' ? r : `${r.content || ''} ${JSON.stringify((r.embeds || []).map((e) => (e.toJSON ? e.toJSON() : e)))}`))
  .join('\n');
const payloadText = (p) => `${p.content || ''} ${JSON.stringify((p.embeds || []).map((e) => (e.toJSON ? e.toJSON() : e)))}`;

(async () => {
  console.log('\nNORTHGATE STAFF HR CHECK');
  console.log('='.repeat(70));

  const settings = require(path.join(ROOT, 'handlers', 'settings'));
  const writerModule = require(path.join(ROOT, 'handlers', 'rosterWriter'));
  const { canManageHR } = require(path.join(ROOT, 'handlers', 'permissions'));
  const { createLeaveManager, parseUntil, setLeaveManager } = require(path.join(ROOT, 'handlers', 'leave'));
  const { logCommand } = require(path.join(ROOT, 'handlers', 'commandlog'));
  const cmd = (name) => require(path.join(ROOT, 'commands', `${name}.js`));

  const resetData = () => {
    for (const f of ['settings.json', 'leave.json']) {
      try { fs.unlinkSync(path.join(DATA, f)); } catch {}
    }
  };

  // One world: both servers marked and configured, a real writer on a fresh sheet.
  function world() {
    resetData();
    const sheet = makeSheet();
    const writer = makeWriter(sheet);
    writerModule.setWriter(writer);
    setLeaveManager(null);

    const client = fakeClient();
    const main = fakeGuild(MAIN, client, 'NGC Main');
    const hub = fakeGuild(HUB, client, 'NorthGate Studios Hub');
    settings.setServer('main', MAIN);
    settings.setServer('hub', HUB);
    settings.updateSettings(HUB, { staffLeadershipRole: LEAD, infractChannel: CH.infract, loaChannel: CH.loa });
    settings.updateSettings(MAIN, { hrRole: HR, logChannel: CH.log });
    const ch = { infract: fakeChannel(client, CH.infract), loa: fakeForum(client, CH.loa), log: fakeChannel(client, CH.log), here: fakeChannel(client, CH.here) };

    const hrUser = fakeUser('700000000000000001', 'hrperson');
    const hrMember = join(main, hrUser, [HR]);
    join(hub, hrUser, []);
    return { sheet, writer, client, main, hub, ch, hrUser, hrMember };
  }

  // Runs a command as the HR person, in the main server.
  async function run(w, name, options, { member = w.hrMember, guild = w.main, user = w.hrUser } = {}) {
    const i = fakeInteraction({ client: w.client, guild, member, user, options, channel: w.ch.here });
    await cmd(name).execute(i);
    return i;
  }

  // =========================================================================
  section('The roster writer: hiring');
  // =========================================================================
  await check('a hire fills the empty placeholder row at the end of its department instead of adding one', async () => {
    const w = world();
    const before = w.sheet.model[OFFICIAL].table.endRowIndex;
    await w.writer.hire({ nickname: 'New', discordId: ID.NEW, robloxId: '42', role: 'PR Staff', section: 'PUBLIC RELATIONS TEAM', date: 'Today' });
    const [row] = w.sheet.rowsFor(OFFICIAL, ID.NEW);
    if (!row) return 'not on the roster';
    if (row.department !== 'PUBLIC RELATIONS TEAM') return `landed under ${row.department}`;
    if (row.row !== 12) return `landed on row ${row.row}, the placeholder was row 12`;
    return w.sheet.model[OFFICIAL].table.endRowIndex === before || 'the table grew when a blank was available';
  });

  await check('the status is written with the exact dropdown text, trailing space included', async () => {
    const w = world();
    await w.writer.hire({ nickname: 'New', discordId: ID.NEW, robloxId: '', role: 'Staff', section: 'COMMUNITY OUTREACH DEPARTMENT', date: 'Today' });
    const [row] = w.sheet.rowsFor(OFFICIAL, ID.NEW);
    return row?.status === 'Active ' || `wrote ${JSON.stringify(row?.status)}`;
  });

  await check('a Discord ID is written as text and ratings as numbers', async () => {
    const w = world();
    await w.writer.hire({ nickname: 'New', discordId: ID.NEW, robloxId: '', role: 'Staff', section: 'COMMUNITY OUTREACH DEPARTMENT', date: 'Today' });
    const [row] = w.sheet.rowsFor(OFFICIAL, ID.NEW);
    if (row.idCell?.stringValue !== ID.NEW) return `ID stored as ${JSON.stringify(row.idCell)}`;
    return (row.perf?.numberValue === 0 && row.act?.numberValue === 0) || `ratings stored as ${JSON.stringify([row.perf, row.act])}`;
  });

  await check('a department with no placeholder gets a row inserted directly under its last person', async () => {
    const w = world();
    const before = w.sheet.model[OFFICIAL].table.endRowIndex;
    await w.writer.hire({ nickname: 'New', discordId: ID.NEW, robloxId: '', role: 'Dev', section: 'STUDIO DEVELOPMENT TEAM', date: 'Today' });
    const [row] = w.sheet.rowsFor(OFFICIAL, ID.NEW);
    if (row?.department !== 'STUDIO DEVELOPMENT TEAM') return `landed under ${row?.department}`;
    if (row.row !== 10) return `landed on row ${row.row}, expected 10`;
    return w.sheet.model[OFFICIAL].table.endRowIndex === before + 1 || 'the table did not grow';
  });

  await check('a department that runs to the last row of the table still gets the hire inside the table', async () => {
    const w = world();
    await w.writer.hire({ nickname: 'New', discordId: ID.NEW, robloxId: '', role: 'HR', section: 'Human Resources & Staff Operations', date: 'Today' });
    const [row] = w.sheet.rowsFor(OFFICIAL, ID.NEW);
    if (!row) return 'the new row fell outside the table';
    return row.department === 'Human Resources & Staff Operations' || `landed under ${row.department}`;
  });

  await check('hiring someone already in that department is refused and changes nothing', async () => {
    const w = world();
    const before = w.sheet.snapshot();
    const err = await rejects(w.writer.hire({ nickname: 'Bravo', discordId: ID.B, robloxId: '', role: 'x', section: 'COMMUNITY OUTREACH DEPARTMENT', date: 'Today' }));
    if (err?.code !== 'already_listed') return `got ${err?.code || 'no error'}`;
    return w.sheet.snapshot() === before || 'the sheet changed';
  });

  await check('someone in one department can still be hired into another', async () => {
    const w = world();
    await w.writer.hire({ nickname: 'Bravo', discordId: ID.B, robloxId: '', role: 'Dev', section: 'STUDIO DEVELOPMENT TEAM', date: 'Today' });
    return w.sheet.rowsFor(OFFICIAL, ID.B).length === 2 || 'the second department was refused';
  });

  await check('a department that is not on the roster is refused and changes nothing', async () => {
    const w = world();
    const before = w.sheet.snapshot();
    const err = await rejects(w.writer.hire({ nickname: 'x', discordId: ID.NEW, robloxId: '', role: 'x', section: 'MADE UP TEAM', date: 'Today' }));
    if (err?.code !== 'no_section') return `got ${err?.code || 'no error'}`;
    return w.sheet.snapshot() === before || 'the sheet changed';
  });

  await check('two hires at the same moment both land, on different rows', async () => {
    const w = world();
    await Promise.all([
      w.writer.hire({ nickname: 'One', discordId: ID.NEW, robloxId: '', role: 'x', section: 'PUBLIC RELATIONS TEAM', date: 'Today' }),
      w.writer.hire({ nickname: 'Two', discordId: ID.NEW2, robloxId: '', role: 'x', section: 'PUBLIC RELATIONS TEAM', date: 'Today' }),
    ]);
    const one = w.sheet.rowsFor(OFFICIAL, ID.NEW)[0];
    const two = w.sheet.rowsFor(OFFICIAL, ID.NEW2)[0];
    if (!one || !two) return `one was lost: ${JSON.stringify([one?.row, two?.row])}`;
    return one.row !== two.row || 'both wrote the same row';
  });

  // =========================================================================
  section('The roster writer: firing');
  // =========================================================================
  await check('firing moves every row they have to the Former roster', async () => {
    const w = world();
    await w.writer.fire({ discordId: ID.A, type: 'Terminated', reason: 'test reason', by: 'hrperson', date: 'Today' });
    if (w.sheet.rowsFor(OFFICIAL, ID.A).length) return 'still on the Official roster';
    const moved = w.sheet.rowsFor(FORMER, ID.A);
    if (moved.length !== 2) return `${moved.length} rows reached the Former roster, expected 2`;
    return moved.every((r) => r.status === 'Terminated') || JSON.stringify(moved.map((r) => r.status));
  });

  await check('the move is a single all-or-nothing change', async () => {
    const w = world();
    const before = w.sheet.calls.batch;
    await w.writer.fire({ discordId: ID.A, type: 'Retired', reason: 'r', by: 'hr', date: 'Today' });
    return w.sheet.calls.batch - before === 1 || `took ${w.sheet.calls.batch - before} separate writes`;
  });

  await check('their ratings, title and history move with them, and the reason is added to Notes', async () => {
    const w = world();
    await w.writer.fire({ discordId: ID.A, type: 'Retired', reason: 'moving on', by: 'hrperson', date: 'Today' });
    const moved = w.sheet.rowsFor(FORMER, ID.A);
    const dev = moved.find((r) => r.roles === 'Developer');
    if (!dev) return 'the Developer row did not keep its title';
    if (dev.perf?.numberValue !== 2) return `rating became ${JSON.stringify(dev.perf)}`;
    return /Retired by hrperson\. moving on/.test(dev.notes) || `notes: ${dev.notes}`;
  });

  await check('a failed write leaves them on the Official roster and off the Former one', async () => {
    const w = world();
    const before = w.sheet.snapshot();
    w.sheet.failNextWrite(500);
    const err = await rejects(w.writer.fire({ discordId: ID.A, type: 'Terminated', reason: 'r', by: 'hr', date: 'Today' }));
    if (!err) return 'no error';
    return w.sheet.snapshot() === before || 'the sheet was half changed';
  });

  await check('with too few empty Former rows, new ones are added inside that table', async () => {
    const w = world();
    // Use up one of the Former roster's two blank rows first.
    await w.writer.fire({ discordId: ID.B, type: 'Retired', reason: 'r', by: 'hr', date: 'Today' });
    await w.writer.fire({ discordId: ID.A, type: 'Retired', reason: 'r', by: 'hr', date: 'Today' });
    const moved = w.sheet.rowsFor(FORMER, ID.A);
    return moved.length === 2 || `only ${moved.length} of 2 rows are inside the Former table`;
  });

  await check('firing someone not on the roster changes nothing at all', async () => {
    const w = world();
    const before = w.sheet.snapshot();
    const err = await rejects(w.writer.fire({ discordId: ID.STRANGER, type: 'Retired', reason: 'r', by: 'hr', date: 'Today' }));
    if (err?.code !== 'not_on_roster') return `got ${err?.code || 'no error'}`;
    return w.sheet.snapshot() === before || 'the sheet changed';
  });

  // =========================================================================
  section('The roster writer: ratings, titles, statuses, notes');
  // =========================================================================
  await check('changing a rating for someone in two departments needs the department', async () => {
    const w = world();
    const err = await rejects(w.writer.setRating({ discordId: ID.A, field: 'performance', stars: 4 }));
    if (err?.code !== 'multiple_rows') return `got ${err?.code || 'no error'}`;
    await w.writer.setRating({ discordId: ID.A, field: 'performance', stars: 4, section: 'STUDIO DEVELOPMENT TEAM' });
    const rows = w.sheet.rowsFor(OFFICIAL, ID.A);
    const dev = rows.find((r) => r.department === 'STUDIO DEVELOPMENT TEAM');
    const own = rows.find((r) => r.department === 'Studio Executive Ownership');
    return (dev.perf?.numberValue === 4 && own.perf?.numberValue === 5) || `dev ${JSON.stringify(dev.perf)}, ownership ${JSON.stringify(own.perf)}`;
  });

  await check('setting a title returns the old one', async () => {
    const w = world();
    const { previous } = await w.writer.setRole({ discordId: ID.B, title: 'Senior Staff' });
    const [row] = w.sheet.rowsFor(OFFICIAL, ID.B);
    return (previous === 'Staff' && row.roles === 'Senior Staff') || `previous ${previous}, now ${row.roles}`;
  });

  await check('a status change reaches every row the person has', async () => {
    const w = world();
    await w.writer.setStatus({ discordId: ID.A, status: 'Suspended' });
    return w.sheet.rowsFor(OFFICIAL, ID.A).every((r) => r.status === 'Suspended') || 'a row was missed';
  });

  await check('"Leave of Absence" is written with the sheet\'s own spelling', async () => {
    const w = world();
    await w.writer.setStatus({ discordId: ID.B, status: 'Leave of Absence' });
    return w.sheet.rowsFor(OFFICIAL, ID.B)[0].status === 'Leave of Absense' || w.sheet.rowsFor(OFFICIAL, ID.B)[0].status;
  });

  await check('lifting a suspension is refused for someone who is not suspended', async () => {
    const w = world();
    const before = w.sheet.snapshot();
    const err = await rejects(w.writer.setStatus({ discordId: ID.D, status: 'Active', onlyFrom: ['Suspended'] }));
    if (err?.code !== 'wrong_status') return `got ${err?.code || 'no error'}`;
    return w.sheet.snapshot() === before || 'the sheet changed';
  });

  await check('a note is added without replacing what was there', async () => {
    const w = world();
    await w.writer.appendText({ discordId: ID.B, field: 'notes', line: 'first' });
    await w.writer.appendText({ discordId: ID.B, field: 'notes', line: 'second' });
    const [row] = w.sheet.rowsFor(OFFICIAL, ID.B);
    return row.notes === 'first\nsecond' || JSON.stringify(row.notes);
  });

  await check('a Warnings cell that says None is replaced by the first real warning', async () => {
    const w = world();
    await w.writer.appendText({ discordId: ID.A, field: 'warnings', line: 'Warning: test' });
    return w.sheet.rowsFor(OFFICIAL, ID.A).every((r) => r.warnings === 'Warning: test') || JSON.stringify(w.sheet.rowsFor(OFFICIAL, ID.A).map((r) => r.warnings));
  });

  await check('a write Google refuses because the bot only has view access says so plainly', async () => {
    const w = world();
    w.sheet.failNextWrite(403);
    const err = await rejects(w.writer.setStatus({ discordId: ID.B, status: 'Suspended' }));
    return /not allowed to edit/.test(err?.message || '') || err?.message;
  });

  // =========================================================================
  section('Leave that ends by itself');
  // =========================================================================
  await check('dates and lengths are understood, and nonsense is refused', () => {
    const now = Date.UTC(2026, 8, 13, 12);
    const date = parseUntil('2026-10-01', now);
    if (date.ms !== Date.UTC(2026, 9, 2)) return `2026-10-01 returned ${new Date(date.ms).toISOString()}`;
    if (parseUntil('7d', now).ms !== now + 7 * 86_400_000) return '7d was wrong';
    if (parseUntil('2w', now).ms !== now + 14 * 86_400_000) return '2w was wrong';
    for (const bad of ['2026-02-30', '2020-01-01', '9999d', 'next week', '']) {
      if (!parseUntil(bad, now).error) return `accepted ${JSON.stringify(bad)}`;
    }
    return true;
  });

  function leaveWorld() {
    const w = world();
    let now = Date.UTC(2026, 8, 13, 12);
    const ended = [];
    const manager = createLeaveManager({ writer: w.writer, now: () => now, log: { warn: () => {} }, onEnded: async (e) => { ended.push(e); } });
    return { ...w, manager, ended, advance: (ms) => { now += ms; }, now: () => now };
  }

  await check('a leave sets their status and nothing happens before the end date', async () => {
    const l = leaveWorld();
    await l.manager.begin({ discordId: ID.B, status: 'Leave of Absence', until: l.now() + 86_400_000, by: 'hr' });
    if (l.sheet.rowsFor(OFFICIAL, ID.B)[0].status !== 'Leave of Absense') return 'status not set';
    await l.manager.checkDue();
    return (l.sheet.rowsFor(OFFICIAL, ID.B)[0].status === 'Leave of Absense' && !l.ended.length) || 'returned early';
  });

  await check('when the end date passes they go back to Active by themselves', async () => {
    const l = leaveWorld();
    await l.manager.begin({ discordId: ID.B, status: 'Reduced Activity', until: l.now() + 86_400_000, by: 'hr' });
    l.advance(86_400_001);
    await l.manager.checkDue();
    if (l.sheet.rowsFor(OFFICIAL, ID.B)[0].status !== 'Active ') return `status is ${JSON.stringify(l.sheet.rowsFor(OFFICIAL, ID.B)[0].status)}`;
    if (Object.keys(l.manager.list()).length) return 'the leave was not cleared';
    return l.ended[0]?.outcome === 'returned' || JSON.stringify(l.ended);
  });

  // The worst thing this feature could do.
  await check('a leave ending never reactivates someone HR has since suspended', async () => {
    const l = leaveWorld();
    await l.manager.begin({ discordId: ID.B, status: 'Leave of Absence', until: l.now() + 1000, by: 'hr' });
    await l.writer.setStatus({ discordId: ID.B, status: 'Suspended' });
    l.advance(2000);
    await l.manager.checkDue();
    if (l.sheet.rowsFor(OFFICIAL, ID.B)[0].status !== 'Suspended') return 'SET A SUSPENDED PERSON BACK TO ACTIVE';
    return l.ended[0]?.outcome === 'wrong_status' || JSON.stringify(l.ended);
  });

  await check('if Google is down when a leave ends, it is retried rather than forgotten', async () => {
    const l = leaveWorld();
    await l.manager.begin({ discordId: ID.B, status: 'Leave of Absence', until: l.now() + 1000, by: 'hr' });
    l.advance(2000);
    l.sheet.failNextWrite(503);
    await l.manager.checkDue();
    if (!l.manager.list()[ID.B]) return 'forgot the leave after one failure';
    await l.manager.checkDue();
    return l.sheet.rowsFor(OFFICIAL, ID.B)[0].status === 'Active ' || 'did not succeed on the retry';
  });

  await check('logging leave again for someone already away just moves the end date', async () => {
    const l = leaveWorld();
    await l.manager.begin({ discordId: ID.B, status: 'Leave of Absence', until: l.now() + 1000, by: 'hr' });
    const { previous } = await l.manager.begin({ discordId: ID.B, status: 'Leave of Absence', until: l.now() + 9000, by: 'hr' });
    return (previous && l.manager.list()[ID.B].until === l.now() + 9000) || 'the end date did not move';
  });

  await check('ending a leave early is refused for someone who is not on leave', async () => {
    const l = leaveWorld();
    const err = await rejects(l.manager.end({ discordId: ID.C }));
    return err?.code === 'wrong_status' || `got ${err?.code || 'no error'}`;
  });

  await check('leaves survive a restart', async () => {
    const l = leaveWorld();
    await l.manager.begin({ discordId: ID.B, status: 'Leave of Absence', until: l.now() + 5000, by: 'hr' });
    const fresh = createLeaveManager({ writer: l.writer, now: l.now, log: { warn: () => {} } });
    return !!fresh.list()[ID.B] || 'a new process did not see the leave';
  });

  // =========================================================================
  section('Who can use the HR commands');
  // =========================================================================
  await check('the HR role in the main server works from the staff hub too', async () => {
    const w = world();
    const u = fakeUser('700000000000000020');
    join(w.main, u, [HR]);
    return (await canManageHR(join(w.hub, u, []))) === true || 'refused';
  });

  await check('no HR role, no Staff Leadership, no admin: refused', async () => {
    const w = world();
    const u = fakeUser('700000000000000021');
    join(w.main, u, []);
    join(w.hub, u, []);
    return (await canManageHR(w.main.members.store.get(u.id))) === false || 'let them in';
  });

  await check('Staff Leadership in the hub can use the HR commands', async () => {
    const w = world();
    const u = fakeUser('700000000000000022');
    join(w.hub, u, [LEAD]);
    return (await canManageHR(join(w.main, u, []))) === true || 'refused leadership';
  });

  await check('an HR command run by someone without access changes nothing', async () => {
    const w = world();
    const u = fakeUser('700000000000000023');
    const before = w.sheet.snapshot();
    const i = await run(w, 'suspend', { user: fakeUser(ID.B), reason: 'x' }, { member: join(w.main, u, []), user: u });
    if (w.sheet.snapshot() !== before) return 'the sheet changed';
    return /need the HR role/.test(said(i)) || said(i);
  });

  // =========================================================================
  section('/hire');
  // =========================================================================
  function hireSetup(w, { editable = true } = {}) {
    const newbie = fakeUser(ID.NEW, 'newbie');
    const newbieMember = join(w.main, newbie, []);
    const rank = { id: RANK, name: 'Community Staff', editable };
    return { newbie, newbieMember, rank };
  }

  await check('/hire puts them on the roster, gives the rank role, welcomes them and DMs a copy', async () => {
    const w = world();
    const { newbie, newbieMember, rank } = hireSetup(w);
    const i = await run(w, 'hire', { user: newbie, department: 'community_outreach', sheet_rank: 'Community Staff', rank, roblox_id: '12345' });
    const [row] = w.sheet.rowsFor(OFFICIAL, ID.NEW);
    if (!row || row.roles !== 'Community Staff') return `roster: ${JSON.stringify(row)}. said: ${said(i)}`;
    if (!newbieMember.roles.added.includes(RANK)) return 'rank role not given';
    if (w.ch.here.sent.length !== 1) return `welcome posted ${w.ch.here.sent.length} times`;
    if (!newbie.dms.length) return 'no DM';
    return i.deferOpts?.flags === MessageFlags.Ephemeral || 'the confirmation is visible to everyone';
  });

  await check('the welcome links the staff handbook as a masked link', async () => {
    const w = world();
    const { newbie, rank } = hireSetup(w);
    await run(w, 'hire', { user: newbie, department: 'development', sheet_rank: 'Developer', rank });
    const text = payloadText(w.ch.here.sent[0] || {});
    return /\[staff handbook\]\(https:\/\/docs\.google\.com\/document\//.test(text) || text;
  });

  await check('/hire checks the bot can give the role before changing anything', async () => {
    const w = world();
    const { newbie, newbieMember, rank } = hireSetup(w, { editable: false });
    const before = w.sheet.snapshot();
    const i = await run(w, 'hire', { user: newbie, department: 'development', sheet_rank: 'Developer', rank });
    if (w.sheet.snapshot() !== before) return 'the roster changed';
    if (newbieMember.roles.added.length || w.ch.here.sent.length || newbie.dms.length) return 'something was sent or given';
    return /ABOVE/.test(said(i)) || said(i);
  });

  await check('/hire for someone not in this server changes nothing', async () => {
    const w = world();
    const before = w.sheet.snapshot();
    const i = await run(w, 'hire', { user: fakeUser(ID.STRANGER), department: 'development', sheet_rank: 'Developer', rank: { id: RANK, name: 'x', editable: true } });
    return (w.sheet.snapshot() === before && /not in this server/.test(said(i))) || said(i);
  });

  await check('if the roster cannot be updated, nobody is welcomed and no role is given', async () => {
    const w = world();
    const { newbie, newbieMember, rank } = hireSetup(w);
    w.sheet.failNextWrite(500);
    await run(w, 'hire', { user: newbie, department: 'development', sheet_rank: 'Developer', rank });
    return (!w.ch.here.sent.length && !newbie.dms.length && !newbieMember.roles.added.length) || 'welcomed or ranked someone who is not on the roster';
  });

  // =========================================================================
  section('/fire');
  // =========================================================================
  function fireSetup(w) {
    const target = fakeUser(ID.A, 'alpha');
    join(w.main, target, []);
    join(w.hub, target, []);
    return target;
  }

  await check('/fire moves them to the Former roster and removes them from the hub, not the community', async () => {
    const w = world();
    const target = fireSetup(w);
    const i = await run(w, 'fire', { user: target, type: 'Terminated', reason: 'test' });
    if (w.sheet.rowsFor(OFFICIAL, ID.A).length) return `still on the roster. said: ${said(i)}`;
    if (w.main.kicked.includes(ID.A)) return 'REMOVED THEM FROM THE MAIN SERVER';
    return w.hub.kicked.includes(ID.A) || `not removed from the hub. said: ${said(i)}`;
  });

  await check('/fire Retired also removes them from the hub', async () => {
    const w = world();
    const target = fireSetup(w);
    await run(w, 'fire', { user: target, type: 'Retired', reason: 'test' });
    return w.hub.kicked.includes(ID.A) || 'retired person was left in the hub';
  });

  await check('/fire DMs them before removing them, and logs it in the hub', async () => {
    const w = world();
    const target = fireSetup(w);
    await run(w, 'fire', { user: target, type: 'Terminated', reason: 'test' });
    if (!target.dms.length) return 'no DM';
    return w.ch.infract.sent.length === 1 || `logged ${w.ch.infract.sent.length} times`;
  });

  await check('/fire with no hub marked changes nothing, removes nobody and tells nobody', async () => {
    const w = world();
    const target = fireSetup(w);
    const all = JSON.parse(fs.readFileSync(path.join(DATA, 'settings.json'), 'utf8'));
    all.servers.hub = null;
    fs.writeFileSync(path.join(DATA, 'settings.json'), JSON.stringify(all));
    const before = w.sheet.snapshot();
    const i = await run(w, 'fire', { user: target, type: 'Terminated', reason: 'test' });
    if (w.sheet.snapshot() !== before) return 'the roster changed';
    if (target.dms.length || w.hub.kicked.length) return 'told or removed somebody';
    return /No staff hub is set/.test(said(i)) || said(i);
  });

  await check('/fire for someone not on the roster removes nobody', async () => {
    const w = world();
    const target = fakeUser(ID.STRANGER);
    join(w.hub, target, []);
    const i = await run(w, 'fire', { user: target, type: 'Terminated', reason: 'test' });
    return (!w.hub.kicked.length && !target.dms.length && /not on the Official Staff Roster/.test(said(i))) || said(i);
  });

  // =========================================================================
  section('/suspend, /unsuspend');
  // =========================================================================
  await check('/suspend sets Suspended and logs it', async () => {
    const w = world();
    await run(w, 'suspend', { user: fakeUser(ID.B), reason: 'test' });
    if (w.sheet.rowsFor(OFFICIAL, ID.B)[0].status !== 'Suspended') return 'status not changed';
    return w.ch.infract.sent.length === 1 || 'not logged';
  });

  await check('/unsuspend sets them back to Active', async () => {
    const w = world();
    await run(w, 'unsuspend', { user: fakeUser(ID.C) });
    return w.sheet.rowsFor(OFFICIAL, ID.C)[0].status === 'Active ' || w.sheet.rowsFor(OFFICIAL, ID.C)[0].status;
  });

  await check('/unsuspend on someone who is not suspended changes nothing', async () => {
    const w = world();
    const before = w.sheet.snapshot();
    const i = await run(w, 'unsuspend', { user: fakeUser(ID.D) });
    return (w.sheet.snapshot() === before && /status is/.test(said(i))) || said(i);
  });

  // =========================================================================
  section('/loalog');
  // =========================================================================
  await check('/loalog starts a leave, remembers the end date and logs it', async () => {
    const w = world();
    const i = await run(w, 'loalog', { user: fakeUser(ID.B), action: 'loa', until: '14d', reason: 'holiday' });
    if (w.sheet.rowsFor(OFFICIAL, ID.B)[0].status !== 'Leave of Absense') return `status not set. said: ${said(i)}`;
    const store = JSON.parse(fs.readFileSync(path.join(DATA, 'leave.json'), 'utf8'));
    if (!store[ID.B]) return 'end date not remembered';
    return w.ch.loa.posts.length === 1 || `made ${w.ch.loa.posts.length} forum posts`;
  });

  await check('/loalog without an end date changes nothing', async () => {
    const w = world();
    const before = w.sheet.snapshot();
    const i = await run(w, 'loalog', { user: fakeUser(ID.B), action: 'ra' });
    return (w.sheet.snapshot() === before && /Add `until`/.test(said(i))) || said(i);
  });

  await check('/loalog with an impossible date changes nothing', async () => {
    const w = world();
    const before = w.sheet.snapshot();
    const i = await run(w, 'loalog', { user: fakeUser(ID.B), action: 'loa', until: '2026-02-30' });
    return (w.sheet.snapshot() === before && /does not exist/.test(said(i))) || said(i);
  });

  await check('/loalog can end a leave early', async () => {
    const w = world();
    await run(w, 'loalog', { user: fakeUser(ID.B), action: 'loa', until: '14d' });
    await run(w, 'loalog', { user: fakeUser(ID.B), action: 'end' });
    return w.sheet.rowsFor(OFFICIAL, ID.B)[0].status === 'Active ' || w.sheet.rowsFor(OFFICIAL, ID.B)[0].status;
  });

  await check('loa_channel only accepts forum channels', () => {
    const option = cmd('config').data.toJSON().options.find((o) => o.name === 'loa_channel');
    return JSON.stringify(option.channel_types) === '[15]' || `channel types ${JSON.stringify(option.channel_types)}`;
  });

  await check('each leave gets its own forum post, named after the leave', async () => {
    const w = world();
    await run(w, 'loalog', { user: fakeUser(ID.B, 'bravo'), action: 'loa', until: '14d' });
    const post = w.ch.loa.posts[0];
    return (post && /^Leave of Absence - bravo$/.test(post.name)) || `post name ${post?.name}`;
  });

  await check('ending a leave early is added inside the same forum post', async () => {
    const w = world();
    await run(w, 'loalog', { user: fakeUser(ID.B), action: 'loa', until: '14d' });
    await run(w, 'loalog', { user: fakeUser(ID.B), action: 'end' });
    if (w.ch.loa.posts.length !== 1) return `made ${w.ch.loa.posts.length} posts`;
    return w.ch.loa.posts[0].messages.length === 2 || `the post has ${w.ch.loa.posts[0].messages.length} messages`;
  });

  await check('a new end date for someone already away is added to their existing post', async () => {
    const w = world();
    await run(w, 'loalog', { user: fakeUser(ID.B), action: 'loa', until: '7d' });
    await run(w, 'loalog', { user: fakeUser(ID.B), action: 'loa', until: '21d' });
    if (w.ch.loa.posts.length !== 1) return `made ${w.ch.loa.posts.length} posts`;
    return w.ch.loa.posts[0].messages.length === 2 || `the post has ${w.ch.loa.posts[0].messages.length} messages`;
  });

  await check('a leave ending by itself is added inside its forum post', async () => {
    const w = world();
    await run(w, 'loalog', { user: fakeUser(ID.B), action: 'loa', until: '14d' });
    const entry = JSON.parse(fs.readFileSync(path.join(DATA, 'leave.json'), 'utf8'))[ID.B];
    if (!entry.threadId) return 'the leave did not remember its post';
    await require(path.join(ROOT, 'handlers', 'hrnotices')).leaveEnded(w.client, { discordId: ID.B, entry, outcome: 'returned' });
    if (w.ch.loa.posts.length !== 1) return `made ${w.ch.loa.posts.length} posts`;
    return w.ch.loa.posts[0].messages.length === 2 || `the post has ${w.ch.loa.posts[0].messages.length} messages`;
  });

  await check('if the leave\'s post was deleted, a new post is started instead of losing the update', async () => {
    const w = world();
    await run(w, 'loalog', { user: fakeUser(ID.B), action: 'loa', until: '14d' });
    w.client._channels.delete(w.ch.loa.posts[0].id);
    await run(w, 'loalog', { user: fakeUser(ID.B), action: 'end' });
    return w.ch.loa.posts.length === 2 || `made ${w.ch.loa.posts.length} posts`;
  });

  // =========================================================================
  section('/addnote, ratings, /infract, /promote');
  // =========================================================================
  await check('/addnote adds a dated, signed note and posts nothing anywhere', async () => {
    const w = world();
    await run(w, 'addnote', { user: fakeUser(ID.B), note: 'handled well' });
    const [row] = w.sheet.rowsFor(OFFICIAL, ID.B);
    if (!/\(hrperson\): handled well$/.test(row.notes)) return `note was ${JSON.stringify(row.notes)}`;
    const posted = Object.values(w.ch).reduce((sum, c) => sum + (c.sent ? c.sent.length : 0) + (c.posts ? c.posts.length : 0), 0);
    return posted === 0 || `posted ${posted} messages`;
  });

  await check('/setperformancerating asks for the department when they are in two', async () => {
    const w = world();
    const i = await run(w, 'setperformancerating', { user: fakeUser(ID.A), stars: 4 });
    if (!/more than one department/.test(said(i))) return said(i);
    await run(w, 'setperformancerating', { user: fakeUser(ID.A), stars: 4, department: 'development' });
    return w.sheet.rowsFor(OFFICIAL, ID.A).find((r) => r.department === 'STUDIO DEVELOPMENT TEAM').perf?.numberValue === 4 || 'not set';
  });

  await check('/setactivityrating sets the Activity column, not Performance', async () => {
    const w = world();
    await run(w, 'setactivityrating', { user: fakeUser(ID.B), stars: 2 });
    const [row] = w.sheet.rowsFor(OFFICIAL, ID.B);
    return (row.act?.numberValue === 2 && row.perf?.numberValue === 3) || `act ${JSON.stringify(row.act)}, perf ${JSON.stringify(row.perf)}`;
  });

  await check('/infract puts a Warning in Warnings and a Strike in Infractions', async () => {
    const w = world();
    await run(w, 'infract', { user: fakeUser(ID.B), type: 'Warning', reason: 'late' });
    await run(w, 'infract', { user: fakeUser(ID.B), type: 'Strike', reason: 'later' });
    const [row] = w.sheet.rowsFor(OFFICIAL, ID.B);
    return (/^Warning: late/.test(row.warnings) && /^Strike: later/.test(row.infractions)) || JSON.stringify([row.warnings, row.infractions]);
  });

  await check('/infract no longer has Fire or Staff Blacklist', () => {
    const choices = cmd('infract').data.toJSON().options.find((o) => o.name === 'type').choices.map((c) => c.value);
    return (!choices.includes('Fire') && !choices.includes('Staff Blacklist')) || choices.join(', ');
  });

  await check('/promote writes the sheet rank, then gives the role', async () => {
    const w = world();
    const u = fakeUser(ID.B);
    const m = join(w.main, u, []);
    const lead = fakeUser('700000000000000030');
    join(w.hub, lead, [LEAD]);
    const i = await run(w, 'promote', { user: u, sheet_rank: 'Senior Staff', rank: { id: RANK, name: 'Senior', editable: true }, reason: 'great work' }, { member: join(w.main, lead, []), user: lead });
    if (w.sheet.rowsFor(OFFICIAL, ID.B)[0].roles !== 'Senior Staff') return `title not set. said: ${said(i)}`;
    return m.roles.added.includes(RANK) || 'role not given';
  });

  await check('/promote for someone not on the roster gives no role', async () => {
    const w = world();
    const u = fakeUser(ID.STRANGER);
    const m = join(w.main, u, []);
    const lead = fakeUser('700000000000000031');
    join(w.hub, lead, [LEAD]);
    await run(w, 'promote', { user: u, sheet_rank: 'x', rank: { id: RANK, name: 'x', editable: true }, reason: 'r' }, { member: join(w.main, lead, []), user: lead });
    return !m.roles.added.length || 'gave a role to someone not on the roster';
  });

  // =========================================================================
  section('/config for the new settings');
  // =========================================================================
  async function configAs(w, guild, options) {
    const u = fakeUser(OWNER);
    const i = fakeInteraction({ client: w.client, guild, member: join(guild, u, []), user: u, options });
    await cmd('config').execute(i);
    return i;
  }

  await check('hr_role and log_channel are main server settings', async () => {
    const w = world();
    await configAs(w, w.main, { hr_role: { id: '500000000000000099' }, log_channel: { id: '600000000000000099' } });
    const i = await configAs(w, w.hub, { hr_role: { id: '500000000000000098' } });
    if (settings.getSettings(MAIN).hrRole !== '500000000000000099') return 'hr_role not saved in main';
    if (settings.getSettings(HUB).hrRole) return 'hr_role was saved in the hub';
    return /belongs to the main server/.test(said(i)) || said(i);
  });

  await check('loa_channel is a staff hub setting', async () => {
    const w = world();
    const i = await configAs(w, w.main, { loa_channel: { id: '600000000000000097' } });
    if (settings.getSettings(MAIN).loaChannel) return 'saved in main';
    return /belongs to the staff hub/.test(said(i)) || said(i);
  });

  // =========================================================================
  section('Command log');
  // =========================================================================
  await check('a command run in the hub is logged in the main server\'s log channel', async () => {
    const w = world();
    const u = fakeUser('700000000000000040', 'someone');
    await logCommand({ client: w.client, guild: w.hub, channel: { id: CH.here }, user: u, name: 'fire' });
    if (w.ch.log.sent.length !== 1) return `logged ${w.ch.log.sent.length} times`;
    const text = payloadText(w.ch.log.sent[0]);
    const want = ['Command Used', '`/fire`', 'Slash command', '<@700000000000000040>', 'someone', `<#${CH.here}>`, 'NorthGate Studios Hub'];
    const missing = want.filter((x) => !text.includes(x));
    return !missing.length || `missing ${missing.join(', ')}`;
  });

  await check('!sc is logged as a prefix command', async () => {
    const w = world();
    await logCommand({ client: w.client, guild: w.main, channel: { id: CH.here }, user: fakeUser('700000000000000041'), name: 'sc', type: 'Prefix command' });
    const text = payloadText(w.ch.log.sent[0] || {});
    return (text.includes('`!sc`') && text.includes('Prefix command')) || text;
  });

  await check('commands in any other server are not logged', async () => {
    const w = world();
    const other = fakeGuild(OTHER, w.client, 'Some Other Server');
    await logCommand({ client: w.client, guild: other, channel: { id: CH.here }, user: fakeUser('700000000000000042'), name: 'hire' });
    return w.ch.log.sent.length === 0 || 'logged a third server';
  });

  await check('the log never includes what was typed into the command', async () => {
    const w = world();
    await logCommand({ client: w.client, guild: w.main, channel: { id: CH.here }, user: fakeUser('700000000000000043'), name: 'addnote', options: { note: 'SECRET NOTE TEXT' } });
    return !payloadText(w.ch.log.sent[0] || {}).includes('SECRET') || 'the note text reached the log';
  });

  await check('with no log channel set, nothing is sent and nothing breaks', async () => {
    const w = world();
    settings.updateSettings(MAIN, { logChannel: null });
    const ok = await logCommand({ client: w.client, guild: w.main, channel: { id: CH.here }, user: fakeUser('700000000000000044'), name: 'hire' });
    return (ok === false && w.ch.log.sent.length === 0) || 'sent something';
  });

  console.log('\nRESULT');
  console.log('='.repeat(70));
  console.log(`  ${failures === 0 ? 'ALL HR CHECKS PASSED' : `${failures} FAILED`}\n`);
  fs.rmSync(DATA, { recursive: true, force: true });
  process.exit(failures === 0 ? 0 : 1);
})();
