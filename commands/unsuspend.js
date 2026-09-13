const { SlashCommandBuilder } = require('discord.js');
const { startHrCommand, explain } = require('../handlers/hrcommand');
const { getWriter } = require('../handlers/rosterWriter');
const { hubSettings } = require('../handlers/settings');
const { actionEmbed, postTo, dm } = require('../handlers/hrnotices');
const { COLORS } = require('../handlers/embeds');

// /unsuspend [user] [reason]
// Sets a suspended staff member back to Active on every roster row they have.
//
// Refuses unless they are actually Suspended. Without that check, /unsuspend run
// on the wrong person would quietly set someone on leave, or already terminated
// from a second row, straight back to Active.
module.exports = {
  data: new SlashCommandBuilder()
    .setName('unsuspend')
    .setDescription('Lift a suspension: sets their roster status back to Active')
    .addUserOption((o) => o.setName('user').setDescription('The suspended staff member').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Optional note on why it was lifted').setMaxLength(500)),

  async execute(interaction) {
    if (!(await startHrCommand(interaction))) return;

    const target = interaction.options.getUser('user');
    const reason = (interaction.options.getString('reason') || '').trim();

    try {
      await getWriter().setStatus({ discordId: target.id, status: 'Active', onlyFrom: ['Suspended'] });
    } catch (err) {
      return interaction.editReply({ content: explain(err, `<@${target.id}>`) });
    }

    const embed = actionEmbed({
      title: 'Suspension Lifted',
      color: COLORS.promote,
      target,
      message: 'Your suspension has been lifted and your status is back to Active.',
      fields: reason ? [{ name: 'Note', value: reason, inline: false }] : [],
      by: interaction.user,
    });
    const dmed = await dm(target, embed);
    const logged = await postTo(interaction.client, hubSettings(interaction.guild.id).infractChannel, {
      content: `<@${target.id}>`,
      embeds: [embed],
      allowedMentions: { parse: [] },
    });
    require('../handlers/hrpanel').refreshSoon();

    const lines = [`Lifted <@${target.id}>'s suspension. Their roster status is back to **Active**.`];
    if (!logged) lines.push('Could not log it. Set infract_channel with /config in the staff hub.');
    if (!dmed) lines.push('Their DMs are closed, so they were not told.');
    return interaction.editReply({ content: lines.join('\n') });
  },
};
