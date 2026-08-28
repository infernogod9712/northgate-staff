// Who is allowed to do what.
//
//   isOwner        - the two ids in .env. Runs !sc and /config, nothing else.
//   canManageStaff - Administrators, or the Staff Leadership role set with /config.
//                    Runs /promote and /infract.
const { PermissionFlagsBits } = require('discord.js');
const { ownerIds } = require('../config');
const { getSettings } = require('./settings');

function isOwner(userId) {
  return ownerIds.includes(userId);
}

function isAdmin(member) {
  return !!member?.permissions?.has(PermissionFlagsBits.Administrator);
}

// Until the Staff Leadership role is set with /config, this is Administrators only.
function canManageStaff(member) {
  if (!member) return false;
  if (isAdmin(member)) return true;
  const s = getSettings(member.guild.id);
  if (!s.staffLeadershipRole) return false;
  return member.roles.cache.has(s.staffLeadershipRole);
}

module.exports = { isOwner, isAdmin, canManageStaff };
