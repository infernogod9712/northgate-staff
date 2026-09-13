// hrpanel.js
// The HR panel: who is at or below 3 stars on Performance, and who is on leave,
// read from the Google Sheets staff roster.
//
//   Auto-updating panels  one message per server, in the channel set with
//                         /config hr_panel_channel, edited in place every 30s
//   /hrpanel              a one-off snapshot for whoever ran it, never updated
//
// The sheet is read ONCE per cycle and that one read feeds every server's panel
// and any /hrpanel run in the meantime. Two panels and a busy admin still cost
// one Google read every 30 seconds.
//
// If a read fails, the panels keep showing the last good data with a note saying
// so. Blanking the panel because Google blinked would look like everyone had
// suddenly been rated and come back from leave.

const { EmbedBuilder, escapeMarkdown } = require('discord.js');
const config = require('../config');
const settings = require('./settings');
const { summarize, LOW_MAX } = require('./roster');
const { createRosterReader } = require('./sheets');
const { isPubliclyReadable } = require('./permissions');
const { COLORS } = require('./embeds');

const FIELD_MAX = 1024;
const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);

function who(person) {
  const name = escapeMarkdown(person.nickname);
  return person.discordId ? `<@${person.discordId}> (${name})` : `${name} (no Discord ID on the roster)`;
}

function describe(person) {
  return person.department ? `${who(person)} · ${escapeMarkdown(person.department)}` : who(person);
}

// Discord rejects an embed field over 1024 characters, and a rejected edit leaves
// the old panel up with no error anywhere. So long lists are cut here and say how
// many were left off.
function fit(lines, empty) {
  if (!lines.length) return empty;
  let out = '';
  for (let i = 0; i < lines.length; i += 1) {
    const next = out ? `${out}\n${lines[i]}` : lines[i];
    const left = lines.length - i - 1;
    const tail = left ? `\n+${left} more on the roster` : '';
    if (next.length + tail.length > FIELD_MAX) {
      return `${out}${out ? '\n' : ''}+${lines.length - i} more on the roster`.slice(0, FIELD_MAX);
    }
    out = next;
  }
  return out;
}

function buildPanelEmbed({ data, error }, { live, intervalSeconds = 30 }) {
  const footer = live
    ? `Updates every ${intervalSeconds} seconds from the staff roster`
    : 'Snapshot from the staff roster. This does not update.';
  const embed = new EmbedBuilder().setTitle('HR Panel').setColor(COLORS.info).setFooter({ text: footer });

  if (!data) {
    return embed
      .setColor(COLORS.infract)
      .setDescription(error ? `Could not read the staff roster: ${error}.` : 'Reading the staff roster...')
      .setTimestamp();
  }

  const { low, leave } = data.summary;

  const lowLines = low.map((p) => (p.rating === 0
    ? `${stars(0)} ${describe(p)} · not rated yet`
    : `${stars(p.rating)} ${describe(p)}`));

  const groups = new Map();
  for (const p of leave) {
    if (!groups.has(p.status)) groups.set(p.status, []);
    groups.get(p.status).push(`- ${describe(p)}`);
  }
  const leaveLines = [];
  for (const [status, lines] of groups) leaveLines.push(`**${status}**`, ...lines);

  embed.addFields(
    { name: `Performance at or below ${LOW_MAX} stars (${low.length})`, value: fit(lowLines, 'Nobody right now.') },
    { name: `On leave (${leave.length})`, value: fit(leaveLines, 'Nobody right now.') },
  );

  if (error) {
    embed
      .setColor(COLORS.infract)
      .setDescription(`Could not reach the staff roster just now (${error}). Showing what it said <t:${Math.floor(data.syncedAt / 1000)}:R>.`);
  }
  return embed.setTimestamp(data.syncedAt);
}

function createHrPanel({
  client,
  reader,
  store = settings,
  intervalMs = 30_000,
  log = console,
  now = () => Date.now(),
}) {
  let data = null;
  let error = null;
  let inFlight = null;
  let timer = null;

  // A problem that repeats every 30 seconds should be logged once, not 120 times
  // an hour. Cleared when it recovers, so a second outage is logged again.
  const warned = new Set();
  const warnOnce = (key, message) => {
    if (warned.has(key)) return;
    warned.add(key);
    log.warn(`[hrpanel] ${message}`);
  };

  async function refresh() {
    try {
      const columns = await reader.readRoster();
      data = { summary: summarize(columns), syncedAt: now() };
      error = null;
      warned.delete('read');
    } catch (err) {
      error = err.message;
      warnOnce('read', `could not read the roster: ${err.message}`);
    }
    return { data, error };
  }

  // The latest data, read fresh only if what is held is older than maxAgeMs.
  async function state(maxAgeMs = intervalMs) {
    if (!data || now() - data.syncedAt >= maxAgeMs) await refresh();
    return { data, error };
  }

  async function updateGuild(guildId, embed) {
    const { hrPanelChannel, hrPanelMessage } = store.getSettings(guildId);
    const channel = await client.channels.fetch(hrPanelChannel).catch(() => null);
    if (!channel || typeof channel.send !== 'function') {
      warnOnce(`missing:${hrPanelChannel}`, `panel channel ${hrPanelChannel} could not be found. Set hr_panel_channel again with /config.`);
      return;
    }

    // Checked on every update, not just when the channel is chosen: a channel that
    // was private on Tuesday can be opened up on Wednesday.
    if (isPubliclyReadable(channel)) {
      warnOnce(`public:${channel.id}`, `not posting in #${channel.name ?? channel.id}: @everyone can read it, and the panel shows performance ratings.`);
      return;
    }
    warned.delete(`public:${channel.id}`);

    const payload = { embeds: [embed], allowedMentions: { parse: [] } };
    if (hrPanelMessage) {
      const message = await channel.messages.fetch(hrPanelMessage).catch(() => null);
      if (message) {
        await message.edit(payload);
        return;
      }
    }
    // First run, or someone deleted the panel: post a new one and remember it.
    const sent = await channel.send(payload);
    store.updateSettings(guildId, { hrPanelMessage: sent.id });
  }

  function tick() {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const targets = store.listGuildIds().filter((id) => store.getSettings(id).hrPanelChannel);
      if (!targets.length) return;

      await refresh();
      const embed = buildPanelEmbed({ data, error }, { live: true, intervalSeconds: Math.round(intervalMs / 1000) });
      for (const guildId of targets) {
        try {
          await updateGuild(guildId, embed);
        } catch (err) {
          warnOnce(`update:${guildId}:${err.message}`, `could not update the panel for server ${guildId}: ${err.message}`);
        }
      }
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  function start() {
    if (timer) return;
    if (!reader.isConfigured()) {
      log.warn('[hrpanel] credentials.json is not in the bot folder, so the HR panel cannot read the roster yet. Copy the service account key there and restart.');
    }
    tick();
    timer = setInterval(tick, intervalMs);
  }

  function stop() {
    clearInterval(timer);
    timer = null;
  }

  return { start, stop, tick, state, intervalMs };
}

// The running bot has exactly one panel. /hrpanel reads from the same one, which
// is what lets a snapshot reuse the last read instead of hitting Google again.
let panel = null;

function getPanel(client) {
  if (!panel) {
    panel = createHrPanel({
      client,
      reader: createRosterReader(config.roster),
      intervalMs: config.hrPanel.intervalSeconds * 1000,
    });
  }
  return panel;
}

// Tests swap in a panel built from fakes.
function setPanel(replacement) {
  panel = replacement;
}

function startHrPanel(client) {
  getPanel(client).start();
}

async function snapshotEmbed(client) {
  const p = getPanel(client);
  return buildPanelEmbed(await p.state(p.intervalMs), { live: false });
}

// A roster change made through a bot command should show on the panels straight
// away, not up to 30 seconds later. Does nothing before the panel has started.
function refreshSoon() {
  if (panel) Promise.resolve(panel.tick()).catch(() => {});
}

module.exports = { createHrPanel, buildPanelEmbed, getPanel, setPanel, startHrPanel, snapshotEmbed, refreshSoon };
