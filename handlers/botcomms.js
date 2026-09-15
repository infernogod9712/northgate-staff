// botcomms.js
// Messages from other NorthGate bots, prefixed bc! ("bot communication").
//
//   bc!hire <Discord ID> <nickname> <Roblox ID>
//
// The ticket bot sends this when a hiring ticket opens. The details are
// remembered against that ticket channel, so when the ticket handler later runs
// /hire in the same channel they only have to pick the department, sheet_rank and
// rank. The nickname may have spaces in it: the first word is the Discord ID, the
// last is the Roblox ID, and everything in between is the nickname.
//
// Only the bot set with /config ticket_bot is listened to. A person or any other
// bot typing bc!hire is ignored, because otherwise anyone could put their own
// details on someone's hire.
//
// Kept in data/pendinghires.json (gitignored) so a restart does not lose a
// ticket's details. Only what /hire needs is kept, and an entry is removed as
// soon as /hire uses it, when the ticket channel is deleted, or after 30 days.

const fs = require('fs');
const path = require('path');
const { getSettings } = require('./settings');

const DATA_DIR = process.env.NGS_DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'pendinghires.json');

const PREFIX = 'bc!';
const MAX_AGE = 30 * 86_400_000;
const SNOWFLAKE = /^\d{17,20}$/;
const NICKNAME_MAX = 50;

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('[bc] could not read pendinghires.json:', err.message);
    return {};
  }
}

function writeStore(store) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(store, null, 2));
}

// Drops entries older than MAX_AGE. Returns true if anything was dropped.
function prune(store, now) {
  let dropped = false;
  for (const [channelId, entry] of Object.entries(store)) {
    if (!(now - entry.at <= MAX_AGE)) {
      delete store[channelId];
      dropped = true;
    }
  }
  return dropped;
}

// "<Discord ID> <nickname> <Roblox ID>" -> { discordId, nickname, robloxId } or { error }.
function parseHire(text) {
  const parts = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  const usage = 'send it as bc!hire <Discord ID> <nickname> <Roblox ID>';
  if (parts.length < 3) return { error: `it needs a Discord ID, a nickname and a Roblox ID (${usage})` };

  const discordId = parts[0].replace(/^<@!?(\d+)>$/, '$1');
  if (!SNOWFLAKE.test(discordId)) return { error: `"${parts[0].slice(0, 40)}" is not a Discord ID (${usage})` };

  const robloxId = parts[parts.length - 1];
  if (!/^\d{1,20}$/.test(robloxId)) return { error: `"${robloxId.slice(0, 40)}" is not a Roblox ID (${usage})` };

  const nickname = parts.slice(1, -1).join(' ');
  if (nickname.length > NICKNAME_MAX) return { error: `the nickname is longer than ${NICKNAME_MAX} characters` };
  return { discordId, nickname, robloxId };
}

// Called for every message a bot sends. Returns { command } when it was a bc!
// message from the trusted ticket bot (handled, even if it was malformed), or
// null when it is none of this file's business.
async function handleBotMessage(message, now = Date.now()) {
  const content = String(message.content ?? '').trim();
  if (!message.guild || !content.toLowerCase().startsWith(PREFIX)) return null;

  const trusted = getSettings(message.guild.id).ticketBot;
  if (!trusted || message.author?.id !== trusted) return null;

  const say = (text) => message.reply({ content: text, allowedMentions: { parse: [], repliedUser: false } }).catch(() => {});
  const [word = '', ...rest] = content.slice(PREFIX.length).trim().split(/\s+/);
  const command = word.toLowerCase();

  if (command !== 'hire') {
    await say(`I do not know the bot command \`bc!${command.slice(0, 30)}\`. Nothing was saved.`);
    return { command: command.slice(0, 30) || '(blank)' };
  }

  const parsed = parseHire(rest.join(' '));
  if (parsed.error) {
    await say(`Could not read that bc!hire: ${parsed.error}. Nothing was saved.`);
    return { command };
  }

  const store = readStore();
  prune(store, now);
  store[message.channel.id] = { ...parsed, guildId: message.guild.id, at: now };
  writeStore(store);
  await message.react('✅').catch(() => {});
  return { command };
}

// The details the ticket bot sent in this channel, or null.
function pendingHire(channelId, now = Date.now()) {
  if (!channelId) return null;
  const store = readStore();
  if (prune(store, now)) writeStore(store);
  return store[channelId] || null;
}

function clearPendingHire(channelId) {
  const store = readStore();
  if (!store[channelId]) return false;
  delete store[channelId];
  writeStore(store);
  return true;
}

module.exports = { handleBotMessage, parseHire, pendingHire, clearPendingHire, PREFIX, MAX_AGE };
