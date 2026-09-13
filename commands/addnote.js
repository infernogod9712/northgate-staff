const { SlashCommandBuilder } = require('discord.js');
const { startHrCommand, explain } = require('../handlers/hrcommand');
const { getWriter, formatDate } = require('../handlers/rosterWriter');

// /addnote [user] [note]
// Adds a dated line to the person's Notes on the roster, signed with who added
// it. It never replaces what is already there.
//
// Deliberately posts nothing anywhere else. Notes hold the most sensitive things
// HR writes down, so the only record is the sheet itself. The command log shows
// that /addnote was used, and never what it said.
module.exports = {
  data: new SlashCommandBuilder()
    .setName('addnote')
    .setDescription('Add a note to a staff member on the roster')
    .addUserOption((o) => o.setName('user').setDescription('The staff member').setRequired(true))
    .addStringOption((o) => o.setName('note').setDescription('The note to add').setRequired(true).setMaxLength(500)),

  async execute(interaction) {
    if (!(await startHrCommand(interaction))) return;

    const target = interaction.options.getUser('user');
    const note = interaction.options.getString('note').trim().replace(/\s*\n\s*/g, ' ');
    const line = `${formatDate(Date.now())} (${interaction.user.username}): ${note}`;

    let rows;
    try {
      ({ rows } = await getWriter().appendText({ discordId: target.id, field: 'notes', line }));
    } catch (err) {
      return interaction.editReply({ content: explain(err, `<@${target.id}>`) });
    }

    return interaction.editReply({
      content: `Added a note to <@${target.id}> on the roster${rows > 1 ? `, on all ${rows} of their department rows` : ''}.`,
    });
  },
};
