const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { getServers, hubSettings } = require('../handlers/settings');
const { canManageStaff } = require('../handlers/permissions');
const { infractionEmbed } = require('../handlers/embeds');

// /infract [user] [type] [reason]
// Log-only for most types. Demotion does NOT remove roles. Fire and Staff
// Blacklist also kick the member from the staff hub. All types share one embed;
// only Type + Reason change.
//
// The kick always targets the staff hub, never the server the command was run
// in. It used to use the current server, so a Fire run from the main server
// removed the person from the whole community while their DM said "removed from
// the staff hub". If no hub has been set, the kick is refused rather than guessed.
const TYPES = ['Warning', 'Strike', 'Suspension', 'Demotion', 'Fire', 'Staff Blacklist'];
const KICKS = ['Fire', 'Staff Blacklist'];

module.exports = {
  TYPES,
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

    if (!(await canManageStaff(interaction.member))) {
      return interaction.editReply({ content: 'You need the Staff Leadership role to use this.' });
    }

    const target = interaction.options.getUser('user');
    const type = interaction.options.getString('type');
    const reason = interaction.options.getString('reason');
    const issuer = interaction.user;
    const kicks = KICKS.includes(type);

    // Refuse before anything is sent. A DM saying "you have been removed" followed
    // by no removal is worse than no infraction at all.
    const { hub } = getServers();
    const hubGuild = hub ? interaction.client.guilds.cache.get(hub) : null;
    if (kicks && !hubGuild) {
      return interaction.editReply({
        content: hub
          ? `I am not in the staff hub any more, so I cannot remove them. Nothing was logged or sent.`
          : `No staff hub is set, so I do not know which server to remove them from. Run \`/config server:hub\` in the staff hub first. Nothing was logged or sent.`,
      });
    }

    let note = null;
    if (type === 'Fire') note = 'You have been removed from the staff hub.';
    if (type === 'Staff Blacklist') note = 'You have been blacklisted from staff and removed from the staff hub.';

    const embed = infractionEmbed(target, type, reason, issuer, note);
    const { infractChannel } = hubSettings(interaction.guild.id);

    // DM the member first, before any kick (a kicked user cannot always be DM'd after).
    await target.send({ embeds: [embed] }).catch(() => {});

    let logged = true;
    if (infractChannel) {
      try {
        const channel = await interaction.client.channels.fetch(infractChannel);
        await channel.send({ content: `<@${target.id}>`, embeds: [embed], allowedMentions: { users: [target.id] } });
      } catch (err) {
        logged = false;
        console.error('[infract] Could not post to infract channel:', err.message);
      }
    } else {
      logged = false;
    }

    let kickNote = '';
    if (kicks) {
      const member = await hubGuild.members.fetch(target.id).catch(() => null);
      if (member) {
        try {
          await member.kick(`${type} by ${issuer.username}: ${reason}`);
          kickNote = `\nRemoved <@${target.id}> from the staff hub.`;
        } catch (err) {
          kickNote = `\nCould not remove them from the staff hub (check my Kick Members permission and role position there): ${err.message}`;
        }
      } else {
        kickNote = '\n(They were not in the staff hub, so there was nobody to remove.)';
      }
    }

    await interaction.editReply({
      content: `Logged **${type}** for <@${target.id}>.${logged ? '' : '\n(Could not log it. Set infract_channel with /config in the staff hub.)'}${kickNote}`,
    });
  },
};
