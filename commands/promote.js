const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { hubSettings } = require('../handlers/settings');
const { canManageStaff } = require('../handlers/permissions');
const { promotionEmbed } = require('../handlers/embeds');
const { getWriter } = require('../handlers/rosterWriter');
const { explain } = require('../handlers/hrcommand');
const { allChoices, byValue, labelFor } = require('../handlers/departments');

// /promote [user] [sheet_rank] [rank] [reason] [department]
// Sets their title in the Roles column of the roster, gives them the rank role
// you pick, logs it to the hub's promotion channel, and DMs them.
//
// The rank role is given in the server you run this in. That is a Discord limit
// rather than a choice: a role option can only list the roles of the server you
// are in. So run /promote in whichever server holds the rank roles. The log
// always goes to the staff hub, wherever it is run from.
//
// Everything that can be checked is checked BEFORE anything changes: that they are
// in this server, and that the bot is allowed to give that role. A promotion that
// updated the roster and then failed on the role would leave the sheet and Discord
// disagreeing about someone's rank.
module.exports = {
  data: new SlashCommandBuilder()
    .setName('promote')
    .setDescription('Promote a staff member to a rank and log it')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addUserOption((o) => o.setName('user').setDescription('The staff member to promote').setRequired(true))
    .addStringOption((o) => o
      .setName('sheet_rank')
      .setDescription('The title to give them on the spreadsheet')
      .setRequired(true)
      .setMaxLength(100))
    .addRoleOption((o) => o.setName('rank').setDescription('The role to give them').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason for the promotion').setRequired(true).setMaxLength(500))
    .addStringOption((o) => o
      .setName('department')
      .setDescription('Only needed if they are listed in more than one department')
      .addChoices(...allChoices())),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!(await canManageStaff(interaction.member))) {
      return interaction.editReply({ content: 'You need the Staff Leadership role to use this.' });
    }

    const target = interaction.options.getUser('user');
    const title = interaction.options.getString('sheet_rank').trim();
    const rank = interaction.options.getRole('rank');
    const reason = interaction.options.getString('reason').trim();
    const department = byValue(interaction.options.getString('department'));
    const promoter = interaction.user;

    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!member) return interaction.editReply({ content: 'That user is not in this server. Nothing was changed.' });

    // `editable` is false when the role is above the bot's own role or the bot lacks
    // Manage Roles. Compared to false on purpose: a role Discord did not fully send
    // has no such field, and that should not block a promotion.
    if (rank.editable === false) {
      return interaction.editReply({ content: `I cannot give **${rank.name}**: my bot role has to be ABOVE it and I need Manage Roles. Nothing was changed.` });
    }

    let sheet;
    try {
      sheet = await getWriter().setRole({ discordId: target.id, title, section: department?.section });
    } catch (err) {
      return interaction.editReply({ content: explain(err, `<@${target.id}>`) });
    }

    try {
      await member.roles.add(rank.id, `Promotion by ${promoter.username}: ${reason}`);
    } catch (err) {
      return interaction.editReply({
        content: `Their roster title is now **${title}**, but I could not add **${rank.name}**: ${err.message}. Check my role position and Manage Roles, then give them the role.`,
      });
    }

    const embed = promotionEmbed(target, rank, reason, promoter, title);
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

    const was = sheet.previous && sheet.previous !== title ? ` (was ${sheet.previous})` : '';
    await interaction.editReply({
      content: `Promoted <@${target.id}> to <@&${rank.id}> and set their roster title to **${title}**${was} under **${labelFor(sheet.department)}**.`
        + (logged ? '' : '\n(Could not log it. Set promote_channel with /config in the staff hub.)'),
    });
  },
};
