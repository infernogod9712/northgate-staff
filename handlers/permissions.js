// Who is allowed to do what.
//
//   isOwner        - the two ids in .env. Runs !sc and /config, nothing else.
//   canManageStaff - Administrators of the server the command is run in, or
//                    anyone holding the Staff Leadership role IN THE STAFF HUB.
//                    Runs /promote, /infract and /reportembed.
const { PermissionFlagsBits } = require('discord.js');
const { ownerIds } = require('../config');
const { getServers, getSettings } = require('./settings');

function isOwner(userId) {
  return ownerIds.includes(userId);
}

function isAdmin(member) {
  return !!member?.permissions?.has(PermissionFlagsBits.Administrator);
}

// The Staff Leadership role lives in the hub, so that is where it is checked,
// even when the command is run from the main server. Checking only the server
// the command ran in meant leadership could not use their own commands from
// the main server at all.
//
// Async because the member has to be looked up in the hub, which is a different
// server from the one the interaction came from.
async function canManageStaff(member) {
  if (!member) return false;
  if (isAdmin(member)) return true;

  const { hub } = getServers();

  // No hub marked yet: fall back to this server's own role, which is how the bot
  // behaved before the two servers were told apart. Keeps an existing setup
  // working until /config server:hub is run.
  if (!hub) {
    const role = getSettings(member.guild.id).staffLeadershipRole;
    return !!role && member.roles.cache.has(role);
  }

  const role = getSettings(hub).staffLeadershipRole;
  if (!role) return false;

  if (member.guild.id === hub) return member.roles.cache.has(role);

  const hubGuild = member.client.guilds.cache.get(hub);
  if (!hubGuild) return false;
  const hubMember = await hubGuild.members.fetch(member.id).catch(() => null);
  return !!hubMember && hubMember.roles.cache.has(role);
}

// True only when it is certain @everyone can see the channel. If the permissions
// cannot be read at all it returns false, rather than blocking setup over
// something unverifiable. Used by the HR panel, which names people with low
// performance ratings and must never land in a channel the whole server can read.
function isPubliclyReadable(channel) {
  try {
    const everyone = channel?.guild?.roles?.everyone;
    if (!everyone || typeof channel.permissionsFor !== 'function') return false;
    return channel.permissionsFor(everyone)?.has(PermissionFlagsBits.ViewChannel) === true;
  } catch {
    return false;
  }
}

// Who may run the HR commands (/hire, /fire, /suspend, /unsuspend, /loalog,
// /infract, /addnote and the rating commands): Administrators of the server they
// are in, Staff Leadership in the hub, or the HR role in the MAIN server.
//
// The HR role is checked in the main server even when the command runs in the
// hub, the same way Staff Leadership is always checked in the hub, so HR can use
// their commands from either server.
async function canManageHR(member) {
  if (!member) return false;
  if (await canManageStaff(member)) return true;

  const { main } = getServers();
  if (!main) return false;
  const role = getSettings(main).hrRole;
  if (!role) return false;

  if (member.guild.id === main) return member.roles.cache.has(role);

  const mainGuild = member.client.guilds.cache.get(main);
  if (!mainGuild) return false;
  const mainMember = await mainGuild.members.fetch(member.id).catch(() => null);
  return !!mainMember && mainMember.roles.cache.has(role);
}

module.exports = { isOwner, isAdmin, canManageStaff, canManageHR, isPubliclyReadable };
