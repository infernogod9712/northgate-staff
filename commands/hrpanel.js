const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { isAdmin } = require('../handlers/permissions');
const { snapshotEmbed } = require('../handlers/hrpanel');

// /hrpanel
// Shows who is at or below 3 stars on Performance and who is on leave, as a
// snapshot that does not update. The auto-updating panels live in the channels set
// with /config hr_panel_channel.
//
// Administrators only, which is what HR asked for. Only the person who ran it can
// see the reply, because it names people with low performance ratings.
module.exports = {
  data: new SlashCommandBuilder()
    .setName('hrpanel')
    .setDescription('See who is at or below 3 stars and who is on leave right now')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // The builder permission is a default a server admin can undo, so check again.
    if (!isAdmin(interaction.member)) {
      return interaction.editReply({ content: 'You need Administrator to use this.' });
    }

    const embed = await snapshotEmbed(interaction.client);
    await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};
