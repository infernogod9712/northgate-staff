const { SlashCommandBuilder } = require('discord.js');
const { startHrCommand, explain } = require('../handlers/hrcommand');
const { getWriter, formatDate } = require('../handlers/rosterWriter');
const { getServers, hubSettings } = require('../handlers/settings');
const { actionEmbed, postTo, dm } = require('../handlers/hrnotices');
const { allChoices, byValue, labelFor } = require('../handlers/departments');
const { COLORS } = require('../handlers/embeds');

// /fire [user] [department] [type] [reason]
// Moves the person's row in that department from the Official Staff Roster to the
// same department on the Former Staff Roster, with Retired or Terminated as their
// status, logs it in the hub's infraction channel and DMs them.
//
// Someone listed in two departments only leaves the one picked. They are removed
// from the staff hub only when that was their last department, because anyone
// still on the Official roster is still staff.
//
// The order matters. The hub is checked before anything happens, so a Fire that
// cannot remove them changes nothing at all. The roster move happens before the
// removal, so if Google is down they are not kicked from a hub while still listed
// as staff. The DM goes before the kick, because a removed member can no longer
// always be messaged.
module.exports = {
  data: new SlashCommandBuilder()
    .setName('fire')
    .setDescription('Remove someone from a department: moves them to the Former roster')
    .addUserOption((o) => o.setName('user').setDescription('The staff member leaving').setRequired(true))
    .addStringOption((o) => o
      .setName('department')
      .setDescription('The department they are leaving')
      .setRequired(true)
      .addChoices(...allChoices()))
    .addStringOption((o) => o
      .setName('type')
      .setDescription('Why they are leaving')
      .setRequired(true)
      .addChoices({ name: 'Retired', value: 'Retired' }, { name: 'Terminated', value: 'Terminated' }))
    .addStringOption((o) => o.setName('reason').setDescription('Goes into their roster notes').setRequired(true).setMaxLength(500)),

  async execute(interaction) {
    if (!(await startHrCommand(interaction))) return;

    const target = interaction.options.getUser('user');
    const department = byValue(interaction.options.getString('department'));
    const type = interaction.options.getString('type');
    const reason = interaction.options.getString('reason').trim();

    if (!department) return interaction.editReply({ content: 'Pick the department they are leaving. Nothing was changed.' });

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
    let result;
    try {
      result = await getWriter().fire({
        discordId: target.id,
        section: department.section,
        type,
        reason,
        by: interaction.user.username,
        date: formatDate(Date.now()),
      });
    } catch (err) {
      if (err.code !== 'verify') return interaction.editReply({ content: explain(err, `<@${target.id}>`) });
      warning = explain(err, `<@${target.id}>`);
      result = err;
    }

    const remaining = result.remaining || [];
    const leftStaff = remaining.length === 0;
    const retired = type === 'Retired';
    const embed = actionEmbed({
      title: retired ? 'Staff Retirement' : 'Staff Termination',
      color: retired ? COLORS.info : COLORS.infract,
      target,
      message: leftStaff
        ? (retired
          ? 'Thank you for your time on the NorthGate Studios staff team.'
          : 'You have been removed from the NorthGate Studios staff team.')
        : (retired
          ? `Thank you for your time in ${department.label}. You are still on the staff team in your other department.`
          : `You have been removed from ${department.label}. You are still on the staff team in your other department.`),
      fields: [
        { name: 'Department', value: department.label, inline: true },
        { name: 'Type', value: type, inline: true },
        { name: 'Reason', value: reason, inline: false },
      ],
      by: interaction.user,
    });

    const dmed = await dm(target, embed);

    let removal;
    if (!leftStaff) {
      removal = `They are still listed under ${remaining.map(labelFor).join(', ')}, so they stay in the staff hub.`;
    } else {
      const hubMember = await hubGuild.members.fetch(target.id).catch(() => null);
      if (!hubMember) {
        removal = 'They were not in the staff hub, so there was nobody to remove.';
      } else {
        try {
          await hubMember.kick(`${type} by ${interaction.user.username}: ${reason}`);
          removal = 'That was their last department, so I removed them from the staff hub.';
        } catch (err) {
          removal = `Could not remove them from the staff hub (check my Kick Members permission and role position there): ${err.message}`;
        }
      }
    }

    const logged = await postTo(interaction.client, hubSettings(interaction.guild.id).infractChannel, {
      content: `<@${target.id}>`,
      embeds: [embed],
      allowedMentions: { parse: [] },
    });
    require('../handlers/hrpanel').refreshSoon();

    const lines = [
      `**${type}**: moved <@${target.id}> out of **${department.label}**, to the same department on the Former Staff Roster.`,
      removal,
    ];
    if (result.addedSection) lines.push(`The Former Staff Roster had no ${department.label} section, so I added one.`);
    if (!logged) lines.push('Could not log it. Set infract_channel with /config in the staff hub.');
    if (!dmed) lines.push('Their DMs are closed, so they were not told.');
    if (warning) lines.push(warning);
    return interaction.editReply({ content: lines.join('\n') });
  },
};
