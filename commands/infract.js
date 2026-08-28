const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { getSettings } = require('../handlers/settings');
const { canManageStaff } = require('../handlers/permissions');
const { infractionEmbed } = require('../handlers/embeds');

// /infract [user] [type] [reason]
// Log-only for most types. Demotion does NOT remove roles. Fire also kicks the
// member from the staff hub. All types share one embed; only Type + Reason change.
const TYPES = ['Warning', 'Strike', 'Suspension', 'Demotion', 'Fire', 'Staff Blacklist'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('infract')
    .setDescription('Log an infraction against a staff member')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addUserOption((o) => o.setName('user').setDescription('The staff member being infracted').setRequired(true))
    .addStringOption((o) =>
      o.setName('type').setDescription('The type of infraction').setRequired(true)
        .addChoices(...TYPES.map((t) => ({ name: t, value: t }))))
    .addStringOption((o) => o.setName('reason').setDescription('Reason for the infraction').setRequired(true)),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!canManageStaff(interaction.member)) {
      return interaction.editReply({ content: 'You need the Staff Leadership role to use this.' });
    }

    const target = interaction.options.getUser('user');
    const type = interaction.options.getString('type');
    const reason = interaction.options.getString('reason');
    const issuer = interaction.user;

    let note = null;
    if (type === 'Fire') note = 'You have been removed from the staff hub.';
    if (type === 'Staff Blacklist') note = 'You have been blacklisted from staff and removed from the staff hub.';

    const embed = infractionEmbed(target, type, reason, issuer, note);
    const s = getSettings(interaction.guild.id);

    // DM the member first, before any kick (a kicked user cannot always be DM'd after).
    await target.send({ embeds: [embed] }).catch(() => {});

    let logged = true;
    if (s.infractChannel) {
      try {
        const channel = await interaction.client.channels.fetch(s.infractChannel);
        await channel.send({ content: `<@${target.id}>`, embeds: [embed], allowedMentions: { users: [target.id] } });
      } catch (err) {
        logged = false;
        console.error('[infract] Could not post to infract channel:', err.message);
      }
    } else {
      logged = false;
    }

    // Fire and Staff Blacklist kick the member from the staff hub.
    let kickNote = '';
    if (type === 'Fire' || type === 'Staff Blacklist') {
      const member = await interaction.guild.members.fetch(target.id).catch(() => null);
      if (member) {
        try {
          await member.kick(`${type} by ${issuer.username}: ${reason}`);
          kickNote = `\nKicked <@${target.id}> from the staff hub.`;
        } catch (err) {
          kickNote = `\nCould not kick them (check my Kick Members permission and role position): ${err.message}`;
        }
      } else {
        kickNote = '\n(User was not in the server to kick.)';
      }
    }

    await interaction.editReply({
      content: `Logged **${type}** for <@${target.id}>.${logged ? '' : '\n(Could not log it - set an infraction channel with /config.)'}${kickNote}`,
    });
  },
};
