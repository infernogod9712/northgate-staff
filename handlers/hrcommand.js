// hrcommand.js
// What every HR command shares: the permission check, and turning a roster error
// into a sentence HR can act on.

const { MessageFlags } = require('discord.js');
const { canManageHR } = require('./permissions');
const { labelFor } = require('./departments');

// Defers privately, then checks permission. Returns false after answering the
// person if they are not allowed, so the command must stop.
async function startHrCommand(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (await canManageHR(interaction.member)) return true;
  await interaction.editReply({ content: 'You need the HR role, Staff Leadership, or Administrator to use this.' });
  return false;
}

function explain(err, who) {
  switch (err?.code) {
    case 'not_on_roster':
      return `${who} is not on the Official Staff Roster, so nothing was changed.`;
    case 'multiple_rows':
      return `${who} is listed in more than one department (${err.departments.map(labelFor).join(', ')}). Run it again and pick the \`department\`.`;
    case 'not_in_department':
      return `${who} is not listed under that department. They are in: ${err.departments.map(labelFor).join(', ')}. Nothing was changed.`;
    case 'already_listed':
      return `${who} is already on the roster in that department, so nothing was changed.`;
    case 'wrong_status':
      return `Nothing was changed: ${who}'s status is ${err.current.join(' / ')}.`;
    case 'unchanged':
      return `Nothing was changed: that is already ${who}'s status.`;
    case 'verify':
      return `The change went through, but ${err.message}.`;
    case 'no_section':
    case 'layout':
      return `The roster does not look the way the bot expects (${err.message}), so nothing was changed.`;
    default:
      return `Could not update the roster: ${err?.message || 'unknown error'}. Nothing was changed.`;
  }
}

module.exports = { startHrCommand, explain };
