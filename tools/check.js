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

const ROOT = path.join(__dirname, '..');
const FILE = path.join(DATA, 'settings.json');

const OWNER = '100000000000000001';
const MAIN = '200000000000000001';
const HUB = '300000000000000001';
const OTHER = '400000000000000001';
const LEAD = '500000000000000001';
const RANK = '500000000000000002';
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
  i.deferReply = async () => { i.deferred = true; };
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

  await check('Fire run from the main server removes them from the hub, not the community', async () => {
    const { client, main, hub, boss, target } = infractSetup();
    const i = fakeInteraction({ client, guild: main, member: join(main, boss), user: boss, options: { user: target, type: 'Fire', reason: 'test' } });
    await commands.infract.execute(i);
    if (main.actions.some((a) => a[0] === 'kick')) return 'KICKED THEM FROM THE MAIN SERVER';
    return hub.actions.some((a) => a[0] === 'kick' && a[1] === target.id) || `no hub kick. said: ${said(i)}`;
  });

  await check('Staff Blacklist also removes from the hub only', async () => {
    const { client, main, hub, boss, target } = infractSetup();
    const i = fakeInteraction({ client, guild: main, member: join(main, boss), user: boss, options: { user: target, type: 'Staff Blacklist', reason: 'test' } });
    await commands.infract.execute(i);
    if (main.actions.some((a) => a[0] === 'kick')) return 'KICKED THEM FROM THE MAIN SERVER';
    return hub.actions.some((a) => a[0] === 'kick') || said(i);
  });

  // A DM saying "you have been removed" followed by no removal is worse than
  // no infraction at all.
  await check('Fire with no hub marked kicks nobody, DMs nobody and logs nothing', async () => {
    const w = world();
    settings.updateSettings(MAIN, { staffLeadershipRole: LEAD, infractChannel: CH_INFRACT });
    const log = fakeChannel(w.client, CH_INFRACT);
    const boss = fakeUser('700000000000000011');
    const target = fakeUser('800000000000000002');
    join(w.main, target);
    const i = fakeInteraction({ client: w.client, guild: w.main, member: join(w.main, boss, [LEAD]), user: boss, options: { user: target, type: 'Fire', reason: 'test' } });
    await commands.infract.execute(i);
    if (w.main.actions.length || w.hub.actions.length) return 'kicked somebody';
    if (target.dms.length) return 'sent a removal DM with no removal';
    if (log.sent.length) return 'logged an infraction that was refused';
    return /No staff hub is set/.test(said(i)) || said(i);
  });

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
      options: { user: target, rank: { id: RANK, name: 'Rank' }, reason: 'test' },
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
      options: { user: target, rank: { id: RANK, name: 'Rank' }, reason: 'test' },
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
      options: { user: target, rank: { id: RANK, name: 'Rank' }, reason: 'test' },
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

  console.log('\nRESULT');
  console.log('='.repeat(70));
  console.log(`  ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} FAILED`}\n`);
  fs.rmSync(DATA, { recursive: true, force: true });
  process.exit(failures === 0 ? 0 : 1);
})();
