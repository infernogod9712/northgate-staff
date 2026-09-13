// ratingcommand.js
// /setperformancerating and /setactivityrating are the same command pointed at 
// different columns, so both are built here.

const { SlashCommandBuilder } = require('discord.js');
const { startHrCommand, explain } = require('./hrcommand');
const { getWriter } = require('./rosterWriter');
const { allChoices, byValue, labelFor } = require('./departments');

function ratingCommand({ name, field, label }) {
  return {
    data: new SlashCommandBuilder()
      .setName(name)
      .setDescription(`Set a staff member's ${label} rating on the roster, from 0 to 5 stars`)
      .addUserOption((o) => o.setName('user').setDescription('The staff member').setRequired(true))
      .addIntegerOption((o) => o
        .setName('stars')
        .setDescription('0 to 5. 0 means not rated yet')
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(5))
      .addStringOption((o) => o
        .setName('department')
        .setDescription('Only needed if they are listed in more than one department')
        .addChoices(...allChoices())),

    async execute(interaction) {
      if (!(await startHrCommand(interaction))) return;

      const target = interaction.options.getUser('user');
      const stars = interaction.options.getInteger('stars');
      const department = byValue(interaction.options.getString('department'));

      let result;
      try {
        result = await getWriter().setRating({ discordId: target.id, field, stars, section: department?.section });
      } catch (err) {
        return interaction.editReply({ content: explain(err, `<@${target.id}>`) });
      }

      require('./hrpanel').refreshSoon();
      const shown = `${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}`;
      return interaction.editReply({
        content: `Set <@${target.id}>'s ${label} rating to ${shown} (${stars}/5) under **${labelFor(result.department)}**.`,
      });
    },
  };
}

module.exports = { ratingCommand };
