const { SlashCommandBuilder } = require('discord.js');
const { startHrCommand, explain } = require('../handlers/hrcommand');
const { getWriter } = require('../handlers/rosterWriter');
const { hubSettings } = require('../handlers/settings');
const { actionEmbed, postTo, dm } = require('../handlers/hrnotices');
const { COLORS } = require('../handlers/embeds');
const { say, createInteractionProgress, withProgress, ProgressFailure } = require('../handlers/progress');

// /suspend [user] [reason]
// Sets their Employment Status to Suspended on every roster row they have, logs it
// in the hub's infraction channel and DMs them. /unsuspend puts them back.
// Discord roles are not touched.
module.exports = {
  data: new SlashCommandBuilder()
    .setName('suspend')
    .setDescription('Suspend a staff member: sets their roster status to Suspended')
    .addUserOption((o) => o.setName('user').setDescription('The staff member').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Why they are being suspended').setRequired(true).setMaxLength(500)),

  async execute(interaction) {
    if (!(await startHrCommand(interaction))) return;

    const target = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason').trim();

    const progress = createInteractionProgress(interaction, `Suspending ${target.username}`, [
      'Update their roster status',
      'DM them',
      'Log it in the infraction channel',
    ]);

    return withProgress(async () => {
      await progress.start();
      await progress.runStep(0, async () => {
        try {
          await getWriter().setStatus({ discordId: target.id, status: 'Suspended' });
        } catch (err) {
          throw new ProgressFailure(explain(err, `<@${target.id}>`));
        }
      });

      const embed = actionEmbed({
        title: 'Staff Suspension',
        color: COLORS.infract,
        target,
        message: 'You have been suspended from the NorthGate Studios staff team. Please review the reason below.',
        fields: [{ name: 'Reason', value: reason, inline: false }],
        by: interaction.user,
      });
      const dmed = await progress.softStep(1, () => dm(target, embed));
      const logged = await progress.softStep(2, () => postTo(interaction.client, hubSettings(interaction.guild.id).infractChannel, {
        content: `<@${target.id}>`,
        embeds: [embed],
        allowedMentions: { parse: [] },
      }));
      require('../handlers/hrpanel').refreshSoon();

      const lines = [say.ok(`Suspended <@${target.id}>. Their roster status is now **Suspended**.`)];
      if (!logged) lines.push(say.warn('Could not log it. Set infract_channel with /config in the staff hub.'));
      if (!dmed) lines.push(say.warn('Their DMs are closed, so they were not told.'));
      await progress.complete(lines.join('\n'));
    });
  },
};
