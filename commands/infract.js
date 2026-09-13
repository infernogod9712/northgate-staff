const { SlashCommandBuilder } = require('discord.js');
const { hubSettings } = require('../handlers/settings');
const { infractionEmbed } = require('../handlers/embeds');
const { startHrCommand, explain } = require('../handlers/hrcommand');
const { getWriter, formatDate } = require('../handlers/rosterWriter');
const { postTo, dm } = require('../handlers/hrnotices');

// /infract [user] [type] [reason]
// Logs an infraction in the hub's infraction channel, DMs the member, and records
// it on the roster: a Warning in the Warnings column, anything else in
// Infractions. Nothing is overwritten.
//
// Fire and Staff Blacklist used to be types here. They moved to /fire, which also
// moves the person to the Former Staff Roster, so there is one way to remove
// someone from staff instead of two that do different things.
const TYPES = ['Warning', 'Strike', 'Suspension', 'Demotion'];

module.exports = {
  TYPES,
  data: new SlashCommandBuilder()
    .setName('infract')
    .setDescription('Log an infraction against a staff member and record it on the roster')
    .addUserOption((o) => o.setName('user').setDescription('The staff member being infracted').setRequired(true))
    .addStringOption((o) =>
      o.setName('type').setDescription('The type of infraction').setRequired(true)
        .addChoices(...TYPES.map((t) => ({ name: t, value: t }))))
    .addStringOption((o) => o.setName('reason').setDescription('Reason for the infraction').setRequired(true).setMaxLength(500)),

  async execute(interaction) {
    if (!(await startHrCommand(interaction))) return;

    const target = interaction.options.getUser('user');
    const type = interaction.options.getString('type');
    const reason = interaction.options.getString('reason').trim();
    const issuer = interaction.user;

    const embed = infractionEmbed(target, type, reason, issuer, null);
    const dmed = await dm(target, embed);
    const logged = await postTo(interaction.client, hubSettings(interaction.guild.id).infractChannel, {
      content: `<@${target.id}>`,
      embeds: [embed],
      allowedMentions: { users: [target.id] },
    });

    const field = type === 'Warning' ? 'warnings' : 'infractions';
    let sheet;
    try {
      await getWriter().appendText({
        discordId: target.id,
        field,
        line: `${type}: ${reason} (${formatDate(Date.now())}, by ${issuer.username})`,
      });
      sheet = `Added to their ${field === 'warnings' ? 'Warnings' : 'Infractions'} on the roster.`;
    } catch (err) {
      sheet = err.code === 'not_on_roster'
        ? 'They are not on the Official Staff Roster, so the sheet was not updated.'
        : explain(err, `<@${target.id}>`);
    }

    const lines = [`Logged **${type}** for <@${target.id}>.`];
    if (!logged) lines.push('(Could not log it. Set infract_channel with /config in the staff hub.)');
    lines.push(sheet);
    if (!dmed) lines.push('Their DMs are closed, so they were not told.');
    return interaction.editReply({ content: lines.join('\n') });
  },
};
