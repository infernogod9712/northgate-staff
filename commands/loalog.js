const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { startHrCommand, explain } = require('../handlers/hrcommand');
const { getLeaveManager, parseUntil } = require('../handlers/leave');
const { hubSettings } = require('../handlers/settings');
const { actionEmbed, postTo, dm } = require('../handlers/hrnotices');
const { COLORS } = require('../handlers/embeds');

// /loalog [user] [action] [until] [reason]
// Starts a Leave of Absence or Reduced Activity with an end date, or ends one
// early. When the end date passes the bot sets them back to Active by itself
// (see handlers/leave.js), so HR never has to change the sheet by hand.
//
// Running it again on someone already on leave just moves their end date.
module.exports = {
  data: new SlashCommandBuilder()
    .setName('loalog')
    .setDescription('Start a leave with an end date, or end one early. They return to Active automatically')
    .addUserOption((o) => o.setName('user').setDescription('The staff member').setRequired(true))
    .addStringOption((o) => o
      .setName('action')
      .setDescription('What to log')
      .setRequired(true)
      .addChoices(
        { name: 'Leave of Absence', value: 'loa' },
        { name: 'Reduced Activity', value: 'ra' },
        { name: 'End their leave early', value: 'end' },
      ))
    .addStringOption((o) => o
      .setName('until')
      .setDescription('When starting a leave: the last day away, like 2026-10-01, or a length like 7d or 2w')
      .setMaxLength(20))
    .addStringOption((o) => o.setName('reason').setDescription('Why they are away').setMaxLength(500)),

  async execute(interaction) {
    if (!(await startHrCommand(interaction))) return;

    const target = interaction.options.getUser('user');
    const action = interaction.options.getString('action');
    const reason = (interaction.options.getString('reason') || '').trim();
    const manager = getLeaveManager(interaction.client);
    const loaChannel = hubSettings(interaction.guild.id).loaChannel;
    const logHint = 'Could not log it. Set loa_channel with /config in the staff hub.';

    if (action === 'end') {
      let entry;
      try {
        ({ entry } = await manager.end({ discordId: target.id }));
      } catch (err) {
        return interaction.editReply({ content: explain(err, `<@${target.id}>`) });
      }
      const what = entry?.status || 'leave';
      const embed = actionEmbed({
        title: 'Leave Ended Early',
        color: COLORS.promote,
        target,
        message: `Their ${what} has been ended early and their status is back to Active.`,
        fields: reason ? [{ name: 'Note', value: reason, inline: false }] : [],
        by: interaction.user,
      });
      const logged = await postTo(interaction.client, loaChannel, { embeds: [embed], allowedMentions: { parse: [] } });
      const dmed = await dm(target, new EmbedBuilder()
        .setColor(COLORS.promote)
        .setTitle('Welcome back')
        .setDescription(`Your ${what} has been ended and your status is back to Active. Welcome back to the team!`)
        .setTimestamp());
      require('../handlers/hrpanel').refreshSoon();

      const lines = [`Ended <@${target.id}>'s ${what}. Their roster status is back to **Active**.`];
      if (!logged) lines.push(logHint);
      if (!dmed) lines.push('Their DMs are closed, so they were not told.');
      return interaction.editReply({ content: lines.join('\n') });
    }

    const status = action === 'loa' ? 'Leave of Absence' : 'Reduced Activity';
    const untilText = interaction.options.getString('until');
    if (!untilText) {
      return interaction.editReply({ content: 'Add `until`: the last day they are away, like 2026-10-01, or a length like 7d or 2w. Nothing was changed.' });
    }
    const parsed = parseUntil(untilText, Date.now());
    if (parsed.error) return interaction.editReply({ content: `That end date does not work: ${parsed.error}. Nothing was changed.` });

    let previous;
    try {
      ({ previous } = await manager.begin({ discordId: target.id, status, until: parsed.ms, reason, by: interaction.user.username }));
    } catch (err) {
      return interaction.editReply({ content: explain(err, `<@${target.id}>`) });
    }

    const back = Math.floor(parsed.ms / 1000);
    const embed = actionEmbed({
      title: status === 'Leave of Absence' ? 'Leave of Absence' : 'Reduced Activity',
      color: COLORS.info,
      target,
      message: `Their status is now ${status}. They will be set back to Active automatically.`,
      fields: [
        { name: 'Back on', value: `<t:${back}:D> (<t:${back}:R>)`, inline: true },
        ...(reason ? [{ name: 'Reason', value: reason, inline: false }] : []),
      ],
      by: interaction.user,
    });
    const logged = await postTo(interaction.client, loaChannel, { embeds: [embed], allowedMentions: { parse: [] } });
    const dmed = await dm(target, embed);
    require('../handlers/hrpanel').refreshSoon();

    const lines = [`Logged **${status}** for <@${target.id}>. They will be set back to Active automatically on <t:${back}:D> (<t:${back}:R>).`];
    if (previous) lines.push('This replaces the end date they already had.');
    if (!logged) lines.push(logHint);
    if (!dmed) lines.push('Their DMs are closed, so they did not get a copy.');
    return interaction.editReply({ content: lines.join('\n') });
  },
};
