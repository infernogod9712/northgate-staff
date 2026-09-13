// tools/check.js
// Tests the two-server setup without Discord or a real token.
//
//   npm run check
//
// Every Discord object here is a fake, and settings are written to a scratch
// folder, so this never touches data/settings.json or talks to the network.
//
// The cases that matter most are the ones that used to be wrong:
//   - a Fire run from the main server kicked the person out of the COMMUNITY
//   - leadership could not use their commands from the main server at all
//   - a promotion or infraction run from the main server logged nowhere
//   - reports went to whichever server had a forum set first

const fs = require('fs');
const os = require('os');
const path = require('path');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ngs-check-'));
process.env.NGS_DATA_DIR = DATA;
process.env.DOTENV_CONFIG_QUIET = 'true';
// Set before config.js loads. dotenv never overrides a variable that already
// exists, so the real .env cannot leak a real owner id into these tests.
process.env.DISCORD_TOKEN = 'test-token';
process.env.CLIENT_ID = '';
process.env.OWNER_ID_1 = '100000000000000001';
process.env.OWNER_ID_2 = '';
// Pointed at a file that does not exist, so no test can ever read a real key.
process.env.GOOGLE_CREDENTIALS_FILE = path.join(DATA, 'no-credentials-here.json');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(DATA, 'settings.json');

const OWNER = '100000000000000001';
const MAIN = '200000000000000001';
const HUB = '300000000000000001';
const OTHER = '400000000000000001';
const LEAD = '500000000000000001';
const RANK = '500000000000000002';
const OLD_RANK = '500000000000000003';
const CH_PROMOTE = '600000000000000001';
const CH_INFRACT = '600000000000000002';
const CH_FORUM = '600000000000000003';
const CH_WRONG_FORUM = '600000000000000004';

let failures = 0;
async function check(label, fn) {
  try {
    const result = await fn();
    if (result === true) console.log(`  ok    ${label}`);
    else { failures += 1; console.log(`  FAIL  ${label}  <- ${result}`); }
  } catch (err) {
    failures += 1;
    console.log(`  FAIL  ${label}  <- threw: ${err.stack.split('\n').slice(0, 2).join(' | ')}`);
  }
}
const section = (t) => console.log(`\n${t}\n${'-'.repeat(70)}`);

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------
const resetSettings = () => { try { fs.unlinkSync(FILE); } catch {} };
const writeRaw = (obj) => fs.writeFileSync(FILE, JSON.stringify(obj));
const readRaw = () => JSON.parse(fs.readFileSync(FILE, 'utf8'));

function fakeUser(id) {
  const u = { id, username: `user${id.slice(-2)}`, dms: [], displayAvatarURL: () => null };
  u.send = async (payload) => { u.dms.push(payload); };
  return u;
}

function fakeClient() {
  const channels = new Map();
  return {
    guilds: { cache: new Map() },
    channels: {
      fetch: async (id) => {
        if (!channels.has(id)) throw new Error('Unknown Channel');
        return channels.get(id);
      },
    },
    _channels: channels,
  };
}

function fakeChannel(client, id) {
  const c = { id, sent: [], threads: { created: [] } };
  c.send = async (payload) => { c.sent.push(payload); return {}; };
  c.threads.create = async (payload) => { c.threads.created.push(payload); return {}; };
  client._channels.set(id, c);
  return c;
}

function fakeGuild(id, client) {
  const g = { id, name: `Guild ${id.slice(0, 1)}`, client, actions: [], members: { store: new Map() } };
  g.members.fetch = async (userId) => {
    if (!g.members.store.has(userId)) throw new Error('Unknown Member');
    return g.members.store.get(userId);
  };
  client.guilds.cache.set(id, g);
  return g;
}

function join(guild, user, roleIds = [], admin = false) {
  const m = {
    id: user.id,
    guild,
    client: guild.client,
    permissions: { has: () => admin },
    roles: { cache: new Set(roleIds) },
  };
  m.roles.add = async (roleId) => { m.roles.cache.add(roleId); guild.actions.push(['role', user.id, roleId]); };
  m.roles.remove = async (roleId) => { m.roles.cache.delete(roleId); guild.actions.push(['unrole', user.id, roleId]); };
  m.kick = async () => { guild.actions.push(['kick', user.id]); guild.members.store.delete(user.id); };
  guild.members.store.set(user.id, m);
  return m;
}

function fakeInteraction({ client, guild, member, user, options = {}, fields = {} }) {
  const i = {
    client, guild, member, user, channel: null, replies: [], deferred: false, replied: false,
    options: {
      getString: (n) => options[n] ?? null,
      getRole: (n) => options[n] ?? null,
      getChannel: (n) => options[n] ?? null,
      getUser: (n) => options[n] ?? null,
    },
    fields: { getTextInputValue: (n) => fields[n] },
  };
  i.deferReply = async (opts) => { i.deferred = true; i.deferOpts = opts; };
  i.editReply = async (p) => { i.replies.push(p); };
  i.reply = async (p) => { i.replied = true; i.replies.push(p); };
  return i;
}

const said = (i) => i.replies
  .map((r) => (typeof r === 'string' ? r : `${r.content || ''} ${JSON.stringify((r.embeds || []).map((e) => (e.toJSON ? e.toJSON() : e)))}`))
  .join('\n');

// A fresh pair of servers with nothing configured.
function world() {
  resetSettings();
  const client = fakeClient();
  return { client, main: fakeGuild(MAIN, client), hub: fakeGuild(HUB, client) };
}

(async () => {
  console.log('\nNORTHGATE STAFF CHECK');
  console.log('='.repeat(70));

  const settings = require(path.join(ROOT, 'handlers', 'settings'));
  const { canManageStaff } = require(path.join(ROOT, 'handlers', 'permissions'));
  const { handleModal } = require(path.join(ROOT, 'handlers', 'interactions'));

  // /promote and /infract now write to the roster. These tests are about Discord
  // behaviour, so they get a writer that always succeeds. The real writer is tested
  // against a simulated sheet in tools/check-hr.js.
  require(path.join(ROOT, 'handlers', 'rosterWriter')).setWriter({
    isConfigured: () => true,
    hire: async () => ({ row: 1, department: 'Test' }),
    fire: async () => ({ moved: 1, department: 'Test', remaining: [], addedSection: false }),
    setRating: async () => ({ department: 'Test' }),
    setRole: async () => ({ previous: 'Old Title', department: 'Test' }),
    setStatus: async () => ({ previous: ['Active'], rows: 1 }),
    appendText: async () => ({ rows: 1 }),
  });

  // -------------------------------------------------------------------------
  section('Everything loads');
  // -------------------------------------------------------------------------
  const commandDir = path.join(ROOT, 'commands');
  const commands = {};
  for (const file of fs.readdirSync(commandDir).filter((f) => f.endsWith('.js'))) {
    await check(`commands/${file} loads and serialises`, () => {
      const cmd = require(path.join(commandDir, file));
      if (!cmd.data || !cmd.execute) return 'missing data or execute';
      cmd.data.toJSON();
      commands[cmd.data.name] = cmd;
      return true;
    });
  }

  await check('/config offers server:hub and server:main', () => {
    const opt = commands.config.data.toJSON().options.find((o) => o.name === 'server');
    const values = (opt?.choices || []).map((c) => c.value).sort().join(',');
    return values === 'hub,main' || `got ${values || 'no server option'}`;
  });

  // -------------------------------------------------------------------------
  section('Settings and migration');
  // -------------------------------------------------------------------------
  await check('a fresh install has no servers marked', () => {
    resetSettings();
    const s = settings.getServers();
    return (s.main === null && s.hub === null) || `got ${JSON.stringify(s)}`;
  });

  await check('old per-server settings are migrated without losing anything', () => {
    resetSettings();
    writeRaw({ [HUB]: { promoteChannel: CH_PROMOTE }, [MAIN]: { staffReportChannel: CH_INFRACT } });
    const hubValue = settings.getSettings(HUB).promoteChannel;
    const mainValue = settings.getSettings(MAIN).staffReportChannel;
    const raw = readRaw();
    if (hubValue !== CH_PROMOTE || mainValue !== CH_INFRACT) return 'a setting was lost in migration';
    if (!raw.guilds || !raw.servers) return `file was not rewritten in the new shape: ${JSON.stringify(raw)}`;
    return true;
  });

  // Guessing which old server is the hub is the exact bug being removed.
  await check('migration does not guess which server is the hub', () => {
    const s = settings.getServers();
    return (s.main === null && s.hub === null) || `guessed ${JSON.stringify(s)}`;
  });

  await check('one server can be both main and hub, for a single test server', () => {
    resetSettings();
    settings.setServer('hub', OTHER);
    settings.setServer('main', OTHER);
    const roles = settings.serverRoles(OTHER).sort().join(',');
    return roles === 'hub,main' || `got ${roles}`;
  });

  await check('the report forum comes from the hub, not whichever server set one first', () => {
    resetSettings();
    settings.updateSettings(OTHER, { staffReportForum: CH_WRONG_FORUM });
    settings.updateSettings(HUB, { staffReportForum: CH_FORUM });
    settings.setServer('hub', HUB);
    return settings.findReportForum() === CH_FORUM || `got ${settings.findReportForum()}`;
  });

  // Deliberately the old behaviour. Pushing this to the live bot restarts it with
  // no servers marked, and reports have to keep working through that window.
  await check('with no hub marked, reports still find a forum the old way', () => {
    resetSettings();
    settings.updateSettings(OTHER, { staffReportForum: CH_WRONG_FORUM });
    return settings.findReportForum() === CH_WRONG_FORUM
      || `got ${settings.findReportForum()}, so a deploy would stop staff reports`;
  });

  // -------------------------------------------------------------------------
  section('/config');
  // -------------------------------------------------------------------------
  await check('bot owners only', async () => {
    const { client, hub } = world();
    const user = fakeUser('900000000000000009');
    const i = fakeInteraction({ client, guild: hub, member: join(hub, user, [], true), user });
    await commands.config.execute(i);
    return /Only the bot owners/.test(said(i)) || said(i);
  });

  await check('a hub setting is refused until the server is marked', async () => {
    const { client, hub } = world();
    const user = fakeUser(OWNER);
    const i = fakeInteraction({ client, guild: hub, member: join(hub, user), user, options: { promote_channel: { id: CH_PROMOTE } } });
    await commands.config.execute(i);
    if (settings.getSettings(HUB).promoteChannel) return 'saved it anyway';
    return /set `server` first/.test(said(i)) || said(i);
  });

  await check('marking the hub and setting its channel work in one command', async () => {
    const { client, hub } = world();
    const user = fakeUser(OWNER);
    const i = fakeInteraction({
      client, guild: hub, member: join(hub, user), user,
      options: { server: 'hub', promote_channel: { id: CH_PROMOTE } },
    });
    await commands.config.execute(i);
    if (settings.getServers().hub !== HUB) return 'hub not marked';
    return settings.getSettings(HUB).promoteChannel === CH_PROMOTE || said(i);
  });

  await check('a hub setting is refused in the main server', async () => {
    const { client, main } = world();
    settings.setServer('main', MAIN);
    const user = fakeUser(OWNER);
    const i = fakeInteraction({ client, guild: main, member: join(main, user), user, options: { infract_channel: { id: CH_INFRACT } } });
    await commands.config.execute(i);
    if (settings.getSettings(MAIN).infractChannel) return 'saved a hub setting into the main server';
    return /belongs to the staff hub/.test(said(i)) || said(i);
  });

  await check('a main setting is refused in the hub', async () => {
    const { client, hub } = world();
    settings.setServer('hub', HUB);
    const user = fakeUser(OWNER);
    const i = fakeInteraction({ client, guild: hub, member: join(hub, user), user, options: { report_channel: { id: CH_INFRACT } } });
    await commands.config.execute(i);
    if (settings.getSettings(HUB).staffReportChannel) return 'saved a main setting into the hub';
    return /belongs to the main server/.test(said(i)) || said(i);
  });

  await check('moving the hub to a new server says it replaced the old one', async () => {
    const { client, hub } = world();
    settings.setServer('hub', OTHER);
    const user = fakeUser(OWNER);
    const i = fakeInteraction({ client, guild: hub, member: join(hub, user), user, options: { server: 'hub' } });
    await commands.config.execute(i);
    return /replaces/.test(said(i)) || said(i);
  });

  // -------------------------------------------------------------------------
  section('Who can manage staff');
  // -------------------------------------------------------------------------
  await check('Staff Leadership in the hub works from the main server', async () => {
    const { main, hub } = world();
    settings.setServer('hub', HUB);
    settings.updateSettings(HUB, { staffLeadershipRole: LEAD });
    const user = fakeUser('700000000000000001');
    join(hub, user, [LEAD]);
    return (await canManageStaff(join(main, user))) === true || 'refused leadership from main';
  });

  await check('no leadership role is refused', async () => {
    const { main, hub } = world();
    settings.setServer('hub', HUB);
    settings.updateSettings(HUB, { staffLeadershipRole: LEAD });
    const user = fakeUser('700000000000000002');
    join(hub, user, []);
    return (await canManageStaff(join(main, user))) === false || 'let them in';
  });

  await check('a leadership role set in the main server does not count once a hub exists', async () => {
    const { main, hub } = world();
    settings.setServer('hub', HUB);
    settings.updateSettings(HUB, { staffLeadershipRole: LEAD });
    settings.updateSettings(MAIN, { staffLeadershipRole: RANK });
    const user = fakeUser('700000000000000003');
    join(hub, user, []);
    return (await canManageStaff(join(main, user, [RANK]))) === false || 'accepted the main server role';
  });

  await check('Administrators of the server they are in are allowed', async () => {
    const { main } = world();
    settings.setServer('hub', HUB);
    return (await canManageStaff(join(main, fakeUser('700000000000000004'), [], true))) === true || 'refused an admin';
  });

  await check('with no hub marked, the old per-server role still works', async () => {
    const { main } = world();
    settings.updateSettings(MAIN, { staffLeadershipRole: LEAD });
    return (await canManageStaff(join(main, fakeUser('700000000000000005'), [LEAD]))) === true || 'broke an existing setup';
  });

  // -------------------------------------------------------------------------
  section('/infract');
  // -------------------------------------------------------------------------
  function infractSetup() {
    const w = world();
    settings.setServer('hub', HUB);
    settings.setServer('main', MAIN);
    settings.updateSettings(HUB, { staffLeadershipRole: LEAD, infractChannel: CH_INFRACT });
    const log = fakeChannel(w.client, CH_INFRACT);
    const boss = fakeUser('700000000000000010');
    join(w.hub, boss, [LEAD]);
    const target = fakeUser('800000000000000001');
    join(w.hub, target);
    join(w.main, target);
    return { ...w, log, boss, target };
  }

  // Fire and Staff Blacklist moved from /infract to /fire. "Removes them from the
  // hub, never the community" is tested against /fire in tools/check-hr.js.

  await check('a Warning never removes anybody', async () => {
    const { client, main, hub, boss, target } = infractSetup();
    const i = fakeInteraction({ client, guild: main, member: join(main, boss), user: boss, options: { user: target, type: 'Warning', reason: 'test' } });
    await commands.infract.execute(i);
    return (!main.actions.length && !hub.actions.length) || 'a warning kicked someone';
  });

  await check('an infraction run from the main server is logged in the hub', async () => {
    const { client, main, boss, target, log } = infractSetup();
    const i = fakeInteraction({ client, guild: main, member: join(main, boss), user: boss, options: { user: target, type: 'Strike', reason: 'test' } });
    await commands.infract.execute(i);
    return log.sent.length === 1 || `hub log received ${log.sent.length}. said: ${said(i)}`;
  });

  // -------------------------------------------------------------------------
  section('/promote');
  // -------------------------------------------------------------------------
  await check('a promotion run from the main server is logged in the hub', async () => {
    const w = world();
    settings.setServer('hub', HUB);
    settings.updateSettings(HUB, { staffLeadershipRole: LEAD, promoteChannel: CH_PROMOTE });
    const log = fakeChannel(w.client, CH_PROMOTE);
    const boss = fakeUser('700000000000000020');
    join(w.hub, boss, [LEAD]);
    const target = fakeUser('800000000000000020');
    const targetInMain = join(w.main, target);
    const i = fakeInteraction({
      client: w.client, guild: w.main, member: join(w.main, boss), user: boss,
      options: { user: target, sheet_rank: 'Test Title', previous_rank: { id: OLD_RANK, name: 'Old Rank' }, new_rank: { id: RANK, name: 'Rank' }, reason: 'test' },
    });
    await commands.promote.execute(i);
    if (!targetInMain.roles.cache.has(RANK)) return `rank not given. said: ${said(i)}`;
    return log.sent.length === 1 || `hub log received ${log.sent.length}`;
  });

  await check('the missing-log hint names a command that exists', async () => {
    const w = world();
    settings.setServer('hub', HUB);
    settings.updateSettings(HUB, { staffLeadershipRole: LEAD });
    const boss = fakeUser('700000000000000021');
    join(w.hub, boss, [LEAD]);
    const target = fakeUser('800000000000000021');
    join(w.hub, target);
    const i = fakeInteraction({
      client: w.client, guild: w.hub, member: w.hub.members.store.get(boss.id), user: boss,
      options: { user: target, sheet_rank: 'Test Title', previous_rank: { id: OLD_RANK, name: 'Old Rank' }, new_rank: { id: RANK, name: 'Rank' }, reason: 'test' },
    });
    await commands.promote.execute(i);
    if (/staffserver/.test(said(i))) return 'still points at /staffserver, which does not exist';
    return /\/config/.test(said(i)) || said(i);
  });

  // -------------------------------------------------------------------------
  section('Deploying onto the live bot, before the servers are marked');
  // -------------------------------------------------------------------------
  // The Pi restarts onto new code the moment it is pushed, with its old settings
  // and no hub or main marked. Nothing that worked before may stop working in that
  // window, except kicking, which was the bug. That one is covered under /infract.

  await check('with no servers marked, a promotion still logs where it used to', async () => {
    const w = world();
    settings.updateSettings(MAIN, { staffLeadershipRole: LEAD, promoteChannel: CH_PROMOTE });
    const log = fakeChannel(w.client, CH_PROMOTE);
    const boss = fakeUser('700000000000000040');
    const target = fakeUser('800000000000000040');
    join(w.main, target);
    const i = fakeInteraction({
      client: w.client, guild: w.main, member: join(w.main, boss, [LEAD]), user: boss,
      options: { user: target, sheet_rank: 'Test Title', previous_rank: { id: OLD_RANK, name: 'Old Rank' }, new_rank: { id: RANK, name: 'Rank' }, reason: 'test' },
    });
    await commands.promote.execute(i);
    return log.sent.length === 1 || `log received ${log.sent.length}. said: ${said(i)}`;
  });

  await check('with no servers marked, a Warning still logs where it used to', async () => {
    const w = world();
    settings.updateSettings(MAIN, { staffLeadershipRole: LEAD, infractChannel: CH_INFRACT });
    const log = fakeChannel(w.client, CH_INFRACT);
    const boss = fakeUser('700000000000000041');
    const target = fakeUser('800000000000000041');
    join(w.main, target);
    const i = fakeInteraction({
      client: w.client, guild: w.main, member: join(w.main, boss, [LEAD]), user: boss,
      options: { user: target, type: 'Warning', reason: 'test' },
    });
    await commands.infract.execute(i);
    return log.sent.length === 1 || `log received ${log.sent.length}. said: ${said(i)}`;
  });

  // -------------------------------------------------------------------------
  section('Staff reports');
  // -------------------------------------------------------------------------
  await check('a report from the main server files into the hub forum', async () => {
    const w = world();
    settings.updateSettings(OTHER, { staffReportForum: CH_WRONG_FORUM });
    settings.updateSettings(HUB, { staffReportForum: CH_FORUM });
    settings.setServer('hub', HUB);
    const right = fakeChannel(w.client, CH_FORUM);
    const wrong = fakeChannel(w.client, CH_WRONG_FORUM);
    const reporter = fakeUser('800000000000000030');
    const i = fakeInteraction({ client: w.client, guild: w.main, user: reporter, fields: { staff: 'someone', details: 'something' } });
    i.customId = 'report_modal';
    await handleModal(i);
    if (wrong.threads.created.length) return 'filed into the wrong server';
    return right.threads.created.length === 1 || `hub forum got ${right.threads.created.length}. said: ${said(i)}`;
  });

  // -------------------------------------------------------------------------
  section('HR panel: reading the roster');
  // -------------------------------------------------------------------------
  // Invented names and ids. The SHAPE matches the real sheet, measured on
  // 2026-09-13: department header rows with no status, blank rows, one person in
  // two departments with different ratings, people with no Discord ID, 0 ratings,
  // and the sheet's own "Leave of Absense" spelling. Golf and Hotel are each
  // unrated in one department and rated in another, which is the case where an
  // unrated row must not be allowed to hide the real rating.
  const { summarize } = require(path.join(ROOT, 'handlers', 'roster'));
  const ROSTER = {
    nickname:    ['Studio Ownership', 'Alpha', 'Bravo', 'Golf', 'Hotel', '', 'Dev Team', 'Charlie', 'Alpha', 'Delta', 'Echo', 'Golf', 'Hotel', 'IT', 'Foxtrot', '', ''],
    discordId:   ['', '111111111111111111', '222222222222222222', '555555555555555555', '666666666666666666', '', '', '333333333333333333', '111111111111111111', '?', '', '555555555555555555', '666666666666666666', '', '444444444444444444', '', ''],
    performance: ['0', '5', '2', '0', '0', '', '0', '0', '3', '1', '4', '4', '2', '0', '0', '0', '0'],
    status:      ['', 'Administrative Leave', 'Active', 'Active', 'Active', '', '', 'Active', 'Active', 'Active', 'Leave of Absense', 'Active', 'Active', '', 'Reduced Activity', '', ''],
  };
  const summary = summarize(ROSTER);
  const names = (list) => list.map((p) => p.nickname);

  await check('department header rows and blank rows are never treated as people', () => {
    const all = [...names(summary.low), ...names(summary.leave)];
    const headers = ['Studio Ownership', 'Dev Team', 'IT'].filter((h) => all.includes(h));
    if (headers.length) return `treated ${headers.join(', ')} as a person`;
    if (summary.departments !== 3) return `counted ${summary.departments} departments, expected 3`;
    return summary.people === 8 || `counted ${summary.people} people, expected 8`;
  });

  await check('someone on the roster twice is listed once, at their lowest real rating', () => {
    const alpha = summary.low.filter((p) => p.nickname === 'Alpha');
    if (alpha.length !== 1) return `listed ${alpha.length} times`;
    return (alpha[0].rating === 3 && alpha[0].department === 'Dev Team') || JSON.stringify(alpha[0]);
  });

  await check('a 0 shows as not rated, and never hides a real rating from another row', () => {
    const charlie = summary.low.find((p) => p.nickname === 'Charlie');
    if (!charlie || charlie.rating !== 0) return `Charlie: ${JSON.stringify(charlie)}`;
    // Golf is rated 4 in one department and unrated in another: not low at all.
    // Hotel is rated 2 in one department and unrated in another: low, at 2.
    if (names(summary.low).includes('Golf')) return 'an unrated row put a 4 star person on the low list';
    const hotel = summary.low.find((p) => p.nickname === 'Hotel');
    return (hotel && hotel.rating === 2) || `Hotel: ${JSON.stringify(hotel)}`;
  });

  await check('people with no real Discord ID on the roster are still listed', () => {
    const delta = summary.low.find((p) => p.nickname === 'Delta');
    return (delta && delta.discordId === null && delta.rating === 1) || JSON.stringify(delta);
  });

  await check('the sheet spelling "Leave of Absense" still counts as leave', () => {
    const echo = summary.leave.find((p) => p.nickname === 'Echo');
    return (echo && echo.status === 'Leave of Absence') || JSON.stringify(echo);
  });

  await check('Active people and 4 or 5 star people are left off', () => {
    if (names(summary.leave).includes('Bravo')) return 'listed an Active person as on leave';
    return !names(summary.low).includes('Echo') || 'listed a 4 star person as low';
  });

  await check('lowest ratings come first, unrated at the bottom', () => {
    const order = names(summary.low).join(',');
    return order === 'Delta,Bravo,Hotel,Alpha,Charlie,Foxtrot' || order;
  });

  // -------------------------------------------------------------------------
  section('HR panel: the embed');
  // -------------------------------------------------------------------------
  const hrpanel = require(path.join(ROOT, 'handlers', 'hrpanel'));
  const embedJson = (embed) => (embed.toJSON ? embed.toJSON() : embed);
  const good = { data: { summary, syncedAt: Date.now() }, error: null };

  await check('people with an ID are mentioned, people without one are named', () => {
    const text = JSON.stringify(embedJson(hrpanel.buildPanelEmbed(good, { live: true })));
    if (!text.includes('<@222222222222222222>')) return 'no mention for Bravo';
    return text.includes('no Discord ID on the roster') || 'Delta was not named';
  });

  await check('a nickname cannot break the embed formatting', () => {
    const odd = summarize({ nickname: ['**bold**'], discordId: [''], performance: ['2'], status: ['Active'] });
    const field = embedJson(hrpanel.buildPanelEmbed({ data: { summary: odd, syncedAt: Date.now() } }, { live: true })).fields[0].value;
    return field.includes('\\*\\*bold') || field;
  });

  await check('a huge roster still fits inside Discord field limits', () => {
    const many = { nickname: [], discordId: [], performance: [], status: [] };
    for (let n = 0; n < 300; n += 1) {
      many.nickname.push(`Person Number ${n}`);
      many.discordId.push(`5${String(n).padStart(17, '0')}`);
      many.performance.push('1');
      many.status.push('Leave of Absense');
    }
    const fields = embedJson(hrpanel.buildPanelEmbed({ data: { summary: summarize(many), syncedAt: Date.now() } }, { live: true })).fields;
    const over = fields.filter((f) => f.value.length > 1024);
    if (over.length) return `a field is ${over[0].value.length} characters`;
    return fields.every((f) => /more on the roster/.test(f.value)) || 'did not say how many were left off';
  });

  await check('before any successful read it shows the problem, not an empty panel', () => {
    const text = JSON.stringify(embedJson(hrpanel.buildPanelEmbed({ data: null, error: 'the roster is not shared with the service account' }, { live: true })));
    return /not shared/.test(text) || text;
  });

  // -------------------------------------------------------------------------
  section('HR panel: /config hr_panel_channel');
  // -------------------------------------------------------------------------
  const CH_PANEL_HUB = '600000000000000005';
  const CH_PANEL_MAIN = '600000000000000006';

  function panelChannel(client, id, { publicView = false } = {}) {
    const everyone = { id: 'everyone' };
    const c = { id, name: `panel${id.slice(-1)}`, guild: { roles: { everyone } }, sent: [], edits: [], messagesById: new Map() };
    c.permissionsFor = (role) => ({ has: () => (role === everyone ? publicView : true) });
    c.send = async (payload) => {
      const msg = { id: `9${String(c.sent.length + 1).padStart(17, '0')}` };
      msg.edit = async (p) => { c.edits.push(p); return msg; };
      c.messagesById.set(msg.id, msg);
      c.sent.push(payload);
      return msg;
    };
    c.messages = {
      fetch: async (messageId) => {
        if (!c.messagesById.has(messageId)) throw new Error('Unknown Message');
        return c.messagesById.get(messageId);
      },
    };
    client._channels.set(id, c);
    return c;
  }

  async function configPanel(guild, client, channel) {
    const user = fakeUser(OWNER);
    const i = fakeInteraction({ client, guild, member: join(guild, user), user, options: { hr_panel_channel: channel } });
    await commands.config.execute(i);
    return i;
  }

  await check('hr_panel_channel can be set in the staff hub', async () => {
    const w = world();
    settings.setServer('hub', HUB);
    const i = await configPanel(w.hub, w.client, panelChannel(w.client, CH_PANEL_HUB));
    return settings.getSettings(HUB).hrPanelChannel === CH_PANEL_HUB || said(i);
  });

  await check('hr_panel_channel can be set in the main server too', async () => {
    const w = world();
    settings.setServer('main', MAIN);
    const i = await configPanel(w.main, w.client, panelChannel(w.client, CH_PANEL_MAIN));
    return settings.getSettings(MAIN).hrPanelChannel === CH_PANEL_MAIN || said(i);
  });

  await check('hr_panel_channel is refused until the server is marked', async () => {
    const w = world();
    const i = await configPanel(w.hub, w.client, panelChannel(w.client, CH_PANEL_HUB));
    if (settings.getSettings(HUB).hrPanelChannel) return 'saved it anyway';
    return /set `server` first/.test(said(i)) || said(i);
  });

  await check('hr_panel_channel refuses a channel @everyone can read', async () => {
    const w = world();
    settings.setServer('hub', HUB);
    const i = await configPanel(w.hub, w.client, panelChannel(w.client, CH_PANEL_HUB, { publicView: true }));
    if (settings.getSettings(HUB).hrPanelChannel) return 'saved a public channel';
    return /@everyone can read/.test(said(i)) || said(i);
  });

  await check('moving the panel to a new channel starts a fresh panel message', async () => {
    const w = world();
    settings.setServer('hub', HUB);
    settings.updateSettings(HUB, { hrPanelChannel: '600000000000000099', hrPanelMessage: '900000000000000001' });
    await configPanel(w.hub, w.client, panelChannel(w.client, CH_PANEL_HUB));
    return settings.getSettings(HUB).hrPanelMessage === null || `kept ${settings.getSettings(HUB).hrPanelMessage}`;
  });

  // -------------------------------------------------------------------------
  section('HR panel: auto-updating');
  // -------------------------------------------------------------------------
  function fakeReader(columns) {
    const r = { calls: 0, fail: null };
    r.isConfigured = () => true;
    r.readRoster = async () => {
      r.calls += 1;
      if (r.fail) throw new Error(r.fail);
      return columns;
    };
    return r;
  }

  function panelWorld({ publicView = false, both = false } = {}) {
    const w = world();
    settings.setServer('hub', HUB);
    settings.setServer('main', MAIN);
    const hubChannel = panelChannel(w.client, CH_PANEL_HUB, { publicView });
    settings.updateSettings(HUB, { hrPanelChannel: CH_PANEL_HUB });
    let mainChannel = null;
    if (both) {
      mainChannel = panelChannel(w.client, CH_PANEL_MAIN);
      settings.updateSettings(MAIN, { hrPanelChannel: CH_PANEL_MAIN });
    }
    const reader = fakeReader(ROSTER);
    const warnings = [];
    const panel = hrpanel.createHrPanel({ client: w.client, reader, log: { warn: (m) => warnings.push(m) } });
    return { ...w, hubChannel, mainChannel, reader, warnings, panel };
  }
  const payloadText = (payload) => JSON.stringify(payload.embeds.map(embedJson));

  await check('the first update posts the panel and remembers the message', async () => {
    const p = panelWorld();
    await p.panel.tick();
    if (p.hubChannel.sent.length !== 1) return `posted ${p.hubChannel.sent.length} times`;
    return settings.getSettings(HUB).hrPanelMessage === '900000000000000001' || `stored ${settings.getSettings(HUB).hrPanelMessage}`;
  });

  await check('after that it edits the same message instead of posting again', async () => {
    const p = panelWorld();
    await p.panel.tick();
    await p.panel.tick();
    await p.panel.tick();
    return (p.hubChannel.sent.length === 1 && p.hubChannel.edits.length === 2) || `sent ${p.hubChannel.sent.length}, edited ${p.hubChannel.edits.length}`;
  });

  await check('if someone deletes the panel message, a new one is posted', async () => {
    const p = panelWorld();
    await p.panel.tick();
    p.hubChannel.messagesById.clear();
    await p.panel.tick();
    if (p.hubChannel.sent.length !== 2) return `sent ${p.hubChannel.sent.length}`;
    return settings.getSettings(HUB).hrPanelMessage === '900000000000000002' || 'did not remember the new message';
  });

  await check('it will not post in a channel @everyone can read, even if one was saved', async () => {
    const p = panelWorld({ publicView: true });
    await p.panel.tick();
    if (p.hubChannel.sent.length) return 'posted performance ratings in a public channel';
    return p.warnings.some((m) => /@everyone can read/.test(m)) || 'did not log why';
  });

  await check('a failed read keeps the last good data instead of blanking the panel', async () => {
    const p = panelWorld();
    await p.panel.tick();
    p.reader.fail = 'Google is down';
    await p.panel.tick();
    const text = payloadText(p.hubChannel.edits.at(-1));
    return (text.includes('Bravo') && text.includes('Could not reach')) || text;
  });

  await check('a repeating failure is logged once, not every 30 seconds', async () => {
    const p = panelWorld();
    p.reader.fail = 'Google is down';
    await p.panel.tick();
    await p.panel.tick();
    await p.panel.tick();
    const n = p.warnings.filter((m) => /could not read the roster/.test(m)).length;
    return n === 1 || `logged ${n} times`;
  });

  await check('two updates running at once do not post two panels', async () => {
    const p = panelWorld();
    await Promise.all([p.panel.tick(), p.panel.tick()]);
    return p.hubChannel.sent.length === 1 || `posted ${p.hubChannel.sent.length} times`;
  });

  await check('both servers get their own panel from a single read of the sheet', async () => {
    const p = panelWorld({ both: true });
    await p.panel.tick();
    if (p.hubChannel.sent.length !== 1 || p.mainChannel.sent.length !== 1) return `hub ${p.hubChannel.sent.length}, main ${p.mainChannel.sent.length}`;
    return p.reader.calls === 1 || `read the sheet ${p.reader.calls} times`;
  });

  await check('with no panel channel set anywhere, the sheet is never read', async () => {
    const w = world();
    settings.setServer('hub', HUB);
    const reader = fakeReader(ROSTER);
    await hrpanel.createHrPanel({ client: w.client, reader, log: { warn: () => {} } }).tick();
    return reader.calls === 0 || `read it ${reader.calls} times`;
  });

  // -------------------------------------------------------------------------
  section('HR panel: /hrpanel');
  // -------------------------------------------------------------------------
  const { MessageFlags } = require('discord.js');

  await check('Staff Leadership without Administrator cannot run /hrpanel', async () => {
    const p = panelWorld();
    hrpanel.setPanel(p.panel);
    settings.updateSettings(HUB, { staffLeadershipRole: LEAD });
    const user = fakeUser('700000000000000050');
    const i = fakeInteraction({ client: p.client, guild: p.hub, member: join(p.hub, user, [LEAD]), user });
    await commands.hrpanel.execute(i);
    if (i.replies.some((r) => r.embeds)) return 'showed the panel to a non-admin';
    return /Administrator/.test(said(i)) || said(i);
  });

  await check('an Administrator gets a snapshot that only they can see', async () => {
    const p = panelWorld();
    hrpanel.setPanel(p.panel);
    const user = fakeUser('700000000000000051');
    const i = fakeInteraction({ client: p.client, guild: p.hub, member: join(p.hub, user, [], true), user });
    await commands.hrpanel.execute(i);
    if (i.deferOpts?.flags !== MessageFlags.Ephemeral) return 'the reply is visible to everyone in the channel';
    const text = said(i);
    return (text.includes('Bravo') && /does not update/.test(text)) || text;
  });

  await check('a snapshot right after a panel update does not read the sheet again', async () => {
    const p = panelWorld();
    hrpanel.setPanel(p.panel);
    await p.panel.tick();
    const user = fakeUser('700000000000000052');
    const i = fakeInteraction({ client: p.client, guild: p.hub, member: join(p.hub, user, [], true), user });
    await commands.hrpanel.execute(i);
    return p.reader.calls === 1 || `read the sheet ${p.reader.calls} times`;
  });

  // -------------------------------------------------------------------------
  section('HR panel: Google sign-in, and what it asks the sheet for');
  // -------------------------------------------------------------------------
  const crypto = require('crypto');
  const { createRosterReader } = require(path.join(ROOT, 'handlers', 'sheets'));
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const KEY_PATH = path.join(DATA, 'test-credentials.json');
  fs.writeFileSync(KEY_PATH, JSON.stringify({
    type: 'service_account',
    client_email: 'panel@test.iam.gserviceaccount.com',
    private_key: privateKey,
    token_uri: 'https://oauth2.googleapis.com/token',
  }));

  // The real header row, with the columns deliberately moved around, plus the
  // sensitive columns the bot must never ask for.
  const MOVED = ['nickname', 'Roblox ID', 'Discord ID', 'Roles', 'Employment Status', 'Performance', 'Infractions', 'Notes'];

  function google({ status = 200 } = {}) {
    const calls = [];
    const reply = (code, body) => ({ ok: code >= 200 && code < 300, status: code, json: async () => body });
    const fetchImpl = async (url, init = {}) => {
      const text = decodeURIComponent(String(url));
      calls.push({ url: text, init });
      if (text.startsWith('https://oauth2.googleapis.com/token')) return reply(200, { access_token: 'test-access', expires_in: 3600 });
      if (status !== 200) return reply(status, { error: { message: 'no' } });
      if (text.includes('values:batchGet')) {
        return reply(200, { valueRanges: [{ values: [['Alpha']] }, { values: [['111111111111111111']] }, { values: [['2']] }, { values: [['Active']] }] });
      }
      return reply(200, { values: [['NGC logo'], MOVED] });
    };
    return { calls, fetchImpl };
  }
  const reader = (fetchImpl, credentialsFile = KEY_PATH) => createRosterReader({ credentialsFile, sheetId: 'test-sheet', tab: 'OFFICAL STAFF ROSTER', fetchImpl });

  await check('columns are found by header name, so moving a column does not break it', async () => {
    const g = google();
    await reader(g.fetchImpl).readRoster();
    const batch = g.calls.find((c) => c.url.includes('values:batchGet'))?.url || '';
    const wanted = ['!A3:A', '!C3:C', '!F3:F', '!E3:E'].filter((r) => !batch.includes(r));
    return !wanted.length || `did not request ${wanted.join(', ')}. url: ${batch}`;
  });

  await check('it never asks the sheet for Infractions or Notes', async () => {
    const g = google();
    await reader(g.fetchImpl).readRoster();
    const batch = g.calls.find((c) => c.url.includes('values:batchGet'))?.url || '';
    return (!batch.includes('!G') && !batch.includes('!H')) || `requested a sensitive column: ${batch}`;
  });

  await check('Discord IDs are read as text, so they cannot lose digits', async () => {
    const g = google();
    await reader(g.fetchImpl).readRoster();
    const batch = g.calls.find((c) => c.url.includes('values:batchGet'))?.url || '';
    return batch.includes('valueRenderOption=FORMATTED_VALUE') || batch;
  });

  await check('it signs in with a real, read-only, correctly signed token', async () => {
    const g = google();
    await reader(g.fetchImpl).readRoster();
    const assertion = g.calls.find((c) => c.url.startsWith('https://oauth2'))?.init.body.get('assertion');
    if (!assertion) return 'never signed in';
    const [h, p, s] = assertion.split('.');
    if (!crypto.createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, Buffer.from(s, 'base64url'))) return 'signature does not verify';
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (!/readonly$/.test(claims.scope)) return `scope is ${claims.scope}, which is not read-only`;
    return claims.iss === 'panel@test.iam.gserviceaccount.com' || `signed as ${claims.iss}`;
  });

  await check('the sign-in is reused, not repeated on every read', async () => {
    const g = google();
    const r = reader(g.fetchImpl);
    await r.readRoster();
    await r.readRoster();
    const n = g.calls.filter((c) => c.url.startsWith('https://oauth2')).length;
    return n === 1 || `signed in ${n} times`;
  });

  await check('a missing key file is reported plainly and nothing is sent to Google', async () => {
    const g = google();
    const r = reader(g.fetchImpl, path.join(DATA, 'nope.json'));
    if (r.isConfigured()) return 'says it is configured with no key file';
    try {
      await r.readRoster();
      return 'read the roster with no key';
    } catch (err) {
      if (g.calls.length) return 'contacted Google anyway';
      return /credentials\.json/.test(err.message) || err.message;
    }
  });

  await check('an unshared sheet says so', async () => {
    const g = google({ status: 403 });
    try {
      await reader(g.fetchImpl).readRoster();
      return 'no error on a 403';
    } catch (err) {
      return /not shared/.test(err.message) || err.message;
    }
  });

  console.log('\nRESULT');
  console.log('='.repeat(70));
  console.log(`  ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} FAILED`}\n`);
  fs.rmSync(DATA, { recursive: true, force: true });
  process.exit(failures === 0 ? 0 : 1);
})();
