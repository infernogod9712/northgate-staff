const { SlashCommandBuilder } = require('discord.js');
const { startHrCommand, explain } = require('../handlers/hrcommand');
const { getWriter, formatDate } = require('../handlers/rosterWriter');
const { getServers, hubSettings } = require('../handlers/settings');
const { actionEmbed, postTo, dm } = require('../handlers/hrnotices');
const { COLORS } = require('../handlers/embeds');

// /fire [user] [type] [reason]
// Moves the person from the Official Staff Roster to the Former Staff Roster with
// Retired or Terminated as their status, removes them from the staff hub, logs it
// in the hub's infraction channel and DMs them.
//
// Every row they have is moved, so someone listed in two departments leaves both.
//
// The order matters. The hub is checked before anything happens, so a Fire that
// cannot remove them changes nothing at all. The roster move happens before the
// removal, so if Google is down they are not kicked from a hub while still listed
// as staff. The DM goes before the kick, because a removed member can no longer
// always be messaged.
module.exports = {
  data: new SlashCommandBuilder()
    .setName('fire')
    .setDescription('Remove someone from staff: moves them to the Former roster and out of the staff hub')
    .addUserOption((o) => o.setName('user').setDescription('The staff member leaving').setRequired(true))
    .addStringOption((o) => o
      .setName('type')
      .setDescription('Why they are leaving')
      .setRequired(true)
      .addChoices({ name: 'Retired', value: 'Retired' }, { name: 'Terminated', value: 'Terminated' }))
    .addStringOption((o) => o.setName('reason').setDescription('Goes into their roster notes').setRequired(true).setMaxLength(500)),

  async execute(interaction) {
    if (!(await startHrCommand(interaction))) return;

    const target = interaction.options.getUser('user');
    const type = interaction.options.getString('type');
    const reason = interaction.options.getString('reason').trim();

    const { hub } = getServers();
    const hubGuild = hub ? interaction.client.guilds.cache.get(hub) : null;
    if (!hubGuild) {
      return interaction.editReply({
        content: hub
          ? 'I am not in the staff hub any more, so I cannot remove them. Nothing was changed.'
          : 'No staff hub is set, so I do not know where to remove them from. Run `/config server:hub` in the staff hub first. Nothing was changed.',
      });
    }

    let warning = null;
    let moved = 0;
    try {
      ({ moved } = await getWriter().fire({
        discordId: target.id,
        type,
        reason,
        by: interaction.user.username,
        date: formatDate(Date.now()),
      }));
    } catch (err) {
      if (err.code !== 'verify') return interaction.editReply({ content: explain(err, `<@${target.id}>`) });
      warning = explain(err, `<@${target.id}>`);
      moved = err.moved;
    }

    const retired = type === 'Retired';
    const embed = actionEmbed({
      title: retired ? 'Staff Retirement' : 'Staff Termination',
      color: retired ? COLORS.info : COLORS.infract,
      target,
      message: retired
        ? 'Thank you for your time on the NorthGate Studios staff team.'
        : 'You have been removed from the NorthGate Studios staff team.',
      fields: [
        { name: 'Type', value: type, inline: true },
        { name: 'Reason', value: reason, inline: false },
      ],
      by: interaction.user,
    });

    const dmed = await dm(target, embed);

    let removal;
    const hubMember = await hubGuild.members.fetch(target.id).catch(() => null);
    if (!hubMember) {
      removal = 'They were not in the staff hub, so there was nobody to remove.';
    } else {
      try {
        await hubMember.kick(`${type} by ${interaction.user.username}: ${reason}`);
        removal = 'Removed them from the staff hub.';
      } catch (err) {
        removal = `Could not remove them from the staff hub (check my Kick Members permission and role position there): ${err.message}`;
      }
    }

    const logged = await postTo(interaction.client, hubSettings(interaction.guild.id).infractChannel, {
      content: `<@${target.id}>`,
      embeds: [embed],
      allowedMentions: { parse: [] },
    });
    require('../handlers/hrpanel').refreshSoon();

    const lines = [
      `**${type}**: moved <@${target.id}> from the Official to the Former Staff Roster${moved > 1 ? ` (all ${moved} of their department rows)` : ''}.`,
      removal,
    ];
    if (!logged) lines.push('Could not log it. Set infract_channel with /config in the staff hub.');
    if (!dmed) lines.push('Their DMs are closed, so they were not told.');
    if (warning) lines.push(warning);
    return interaction.editReply({ content: lines.join('\n') });
  },
};
