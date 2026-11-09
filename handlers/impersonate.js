// impersonate.js
// d!impersonate, the same developer tool NorthGate OS and Frontier OS have.
// Every NorthGate bot answers it for its OWN commands, checked against its own
// settings, so the answer is real rather than a guess from another bot.
//
//   d!impersonate list                   every Staff Management command
//   d!impersonate <user> <command>       could that person run it here? Nothing runs.
//
// Bot owners only (OWNER_IDS in .env). A command that is not one of ours gets no
// reply, so in a server with NorthGate OS only the bot that owns it answers.

const { PermissionFlagsBits } = require('discord.js');
const { isOwner, isAdmin, canManageStaff, canManageHR, isBanned } = require('./permissions');
const { say } = require('./progress');

const PREFIX = 'd!impersonate';

// Who can run what. Keep in step with each command's own check.
const HR = ['hire', 'fire', 'suspend', 'unsuspend', 'loalog', 'infract', 'addnote', 'setperformancerating', 'setactivityrating'];
const LEADERSHIP = ['promote', 'demote', 'reportembed'];
const ACCESS_TEXT = {
  hr: 'HR role (main server), Staff Leadership (staff hub), or Administrator',
  leadership: 'Staff Leadership (staff hub) or Administrator',
  admin: 'Administrator',
  owner: 'Bot owners',
};

function accessFor(name) {
  if (HR.includes(name)) return 'hr';
  if (LEADERSHIP.includes(name)) return 'leadership';
  if (name === 'hrpanel') return 'admin';
  if (name === 'config') return 'owner';
  return null;
}

async function evaluate(name, member) {
  const kind = accessFor(name);
  const text = ACCESS_TEXT[kind];

  if (kind === 'owner') {
    return isOwner(member.id)
      ? { result: 'allowed', reason: `${text}.` }
      : { result: 'blocked', reason: `Requires: ${text}.` };
  }
  if (isBanned(member.id)) {
    return { result: 'blocked', reason: 'They are on the HR command ban list, which beats every role.' };
  }

  let allowed;
  if (kind === 'hr') allowed = await canManageHR(member);
  else if (kind === 'leadership') allowed = await canManageStaff(member);
  else allowed = isAdmin(member);

  let reason = allowed ? `Has access: ${text}.` : `Requires: ${text}.`;
  // Discord also hides /promote and /demote from people without Manage Roles,
  // unless a server admin has changed the command's permissions.
  if (allowed && ['promote', 'demote'].includes(name) && !member.permissions?.has?.(PermissionFlagsBits.ManageRoles)) {
    reason += ' Discord may still hide the command from them: it defaults to members with Manage Roles.';
  }
  return { result: allowed ? 'allowed' : 'blocked', reason };
}

function listPages(client) {
  const lines = [...client.commands.values()]
    .map((command) => command.data.toJSON())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((command) => `• \`/${command.name}\` - ${command.description || 'No description provided.'}`);
  const prefixLines = [
    `• \`${PREFIX} <user> <command>\` - Check whether someone could run a command, without running it.`,
  ];

  const pages = [];
  let page = '';
  const section = (heading, entries) => {
    if (page && page.length + heading.length + 1 > 1900) {
      pages.push(page);
      page = '';
    }
    page += `${heading}\n`;
    for (const entry of entries) {
      if (page.length + entry.length + 1 > 1900) {
        pages.push(page);
        page = `${heading} (continued)\n`;
      }
      page += `${entry}\n`;
    }
  };
  section('📋 **Staff Management slash commands:**', lines);
  section('📋 **Staff Management prefix commands:**', prefixLines);
  if (page) pages.push(page);
  return pages;
}

// Returns the name to log when it handled the message, or null when the message
// was not for this bot.
async function handleImpersonate(message) {
  const content = message.content.trim();
  if (!content.toLowerCase().startsWith(PREFIX)) return null;

  const args = content.slice(PREFIX.length).trim().split(/\s+/).filter(Boolean);
  const isList = ['list', 'commands'].includes(args[0]?.toLowerCase());
  const targetCommand = args[1]?.toLowerCase().replace(/^\//, '');
  const ours = isList || (targetCommand && (accessFor(targetCommand) || message.client.commands.has(targetCommand)));
  if (!ours) return null;

  if (!isOwner(message.author.id)) {
    await message.reply(say.error('d!impersonate is for the bot owners only.')).catch(() => {});
    return 'd!impersonate';
  }

  if (isList) {
    for (const page of listPages(message.client)) await message.reply(page);
    return 'd!impersonate';
  }

  const targetId = args[0]?.match(/^<@!?(\d+)>$/)?.[1] || args[0];
  if (!/^\d{17,20}$/.test(targetId || '')) {
    await message.reply(say.error('Usage: `d!impersonate <user ID or mention> <command>`'));
    return 'd!impersonate';
  }
  const member = await message.guild.members.fetch(targetId).catch(() => null);
  if (!member) {
    await message.reply(say.error('That user could not be found in this server.'));
    return 'd!impersonate';
  }

  const access = await evaluate(targetCommand, member);
  const label = { allowed: '✅ WOULD EXECUTE', blocked: '❌ WOULD BE BLOCKED' }[access.result];
  await message.reply({
    content: [
      `🔎 **${label}**: **${member.user.tag}** running \`/${targetCommand}\` (Staff Management)`,
      '',
      access.reason,
      'No command was executed.',
    ].join('\n'),
    allowedMentions: { parse: [] },
  });
  return 'd!impersonate';
}

module.exports = { handleImpersonate, evaluate, accessFor };
