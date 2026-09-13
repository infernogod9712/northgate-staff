const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { hubSettings } = require('../handlers/settings');
const { canManageStaff } = require('../handlers/permissions');
const { promotionEmbed } = require('../handlers/embeds');

// /promote [user] [rank] [reason]
// Gives the member the rank role you pick, logs it to the hub's promotion channel,
// and DMs them.
//
// The rank is given in the server you run this in. That is a Discord limit rather
// than a choice: a role option can only list the roles of the server you are in.
// So run /promote in whichever server holds the rank roles. The log always goes to
// the staff hub, wherever it is run from.
module.exports = {
  data: new SlashCommandBuilder()
    .setName('promote')
    .setDescription('Promote a staff member to a rank and log it')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addUserOption((o) => o.setName('user').setDescription('The staff member to promote').setRequired(true))
    .addRoleOption((o) => o.setName('rank').setDescription('The rank role to give them').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason for the promotion').setRequired(true)),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!(await canManageStaff(interaction.member))) {
      return interaction.editReply({ content: 'You need the Staff Leadership role to use this.' });
    }

    const target = interaction.options.getUser('user');
    const rank = interaction.options.getRole('rank');
    const reason = interaction.options.getString('reason');
    const promoter = interaction.user;

    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!member) return interaction.editReply({ content: 'That user is not in this server.' });

    try {
      await member.roles.add(rank.id, `Promotion by ${promoter.username}: ${reason}`);
    } catch (err) {
      if (err.code === 50013) {
        return interaction.editReply({ content: `I could not add **${rank.name}**. Make sure my bot role is ABOVE that rank and I have Manage Roles.` });
      }
      return interaction.editReply({ content: `Could not add the rank: ${err.message}` });
    }

    const embed = promotionEmbed(target, rank, reason, promoter);
    const { promoteChannel } = hubSettings(interaction.guild.id);

    let logged = true;
    if (promoteChannel) {
      try {
        const channel = await interaction.client.channels.fetch(promoteChannel);
        await channel.send({ content: `<@${target.id}>`, embeds: [embed], allowedMentions: { users: [target.id] } });
      } catch (err) {
        logged = false;
        console.error('[promote] Could not post to promote channel:', err.message);
      }
    } else {
      logged = false;
    }

    await target.send({ embeds: [embed] }).catch(() => {});

    await interaction.editReply({
      content: `Promoted <@${target.id}> to <@&${rank.id}>.${logged ? '' : '\n(Could not log it. Set promote_channel with /config in the staff hub.)'}`,
    });
  },
};
