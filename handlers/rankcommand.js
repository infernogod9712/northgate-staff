// rankcommand.js
// /promote and /demote are the same command in opposite directions: set their
// title in the roster's Roles column, take one rank role away and give another,
// log it in the staff hub and DM them. Both are built here so they cannot drift
// apart.
//
// The rank roles are the ones in the server you run it in. That is a Discord
// limit rather than a choice: a role option can only list the roles of the server
// you are in. So run it in whichever server holds the rank roles. The log always
// goes to the staff hub, wherever it is run from.
//
// Everything that can be checked is checked BEFORE anything changes: that they are
// in this server, that the two roles are different, and that the bot is allowed
// to give and take both. A rank change that updated the roster and then failed on
// a role would leave the sheet and Discord disagreeing about someone's rank.
//
// The new role is given before the old one is taken away, so a failure halfway
// leaves them with both ranks rather than with none.
const { say, createInteractionProgress, withProgress, ProgressFailure } = require('./progress');

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { hubSettings } = require('./settings');
const { canManageStaff, isBanned, BANNED_MESSAGE } = require('./permissions');
const { rankChangeEmbed } = require('./embeds');
const { getWriter } = require('./rosterWriter');
const { explain } = require('./hrcommand');
const { postTo, dm } = require('./hrnotices');
const { allChoices, byValue, labelFor } = require('./departments');

// Promotions go to the promotion log. Demotions are disciplinary, so they go to
// the infraction log with suspensions and firings.
const KINDS = {
  promote: { verb: 'Promote', past: 'Promoted', noun: 'promotion', logKey: 'promoteChannel', logOption: 'promote_channel' },
  demote: { verb: 'Demote', past: 'Demoted', noun: 'demotion', logKey: 'infractChannel', logOption: 'infract_channel' },
};

function rankCommand(kind) {
  const k = KINDS[kind];
  if (!k) throw new Error(`not a rank command: ${kind}`);

  return {
    data: new SlashCommandBuilder()
      .setName(kind)
      .setDescription(`${k.verb} a staff member: new roster title, swap their rank role, and log it`)
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
      .addUserOption((o) => o.setName('user').setDescription(`The staff member to ${kind}`).setRequired(true))
      .addStringOption((o) => o
        .setName('sheet_rank')
        .setDescription('The title to give them on the spreadsheet')
        .setRequired(true)
        .setMaxLength(100))
      .addRoleOption((o) => o.setName('previous_rank').setDescription('The rank role they have now. It is taken away').setRequired(true))
      .addRoleOption((o) => o.setName('new_rank').setDescription('The role to give them').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription(`Reason for the ${k.noun}`).setRequired(true).setMaxLength(500))
      .addStringOption((o) => o
        .setName('department')
        .setDescription('Only needed if they are listed in more than one department')
        .addChoices(...allChoices())),

    async execute(interaction) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      if (isBanned(interaction.user.id)) {
        return interaction.editReply({ content: say.error(BANNED_MESSAGE) });
      }
      if (!(await canManageStaff(interaction.member))) {
        return interaction.editReply({ content: say.error('You need the Staff Leadership role to use this.') });
      }

      const target = interaction.options.getUser('user');
      const title = interaction.options.getString('sheet_rank').trim();
      const previous = interaction.options.getRole('previous_rank');
      const next = interaction.options.getRole('new_rank');
      const reason = interaction.options.getString('reason').trim();
      const department = byValue(interaction.options.getString('department'));
      const issuer = interaction.user;

      if (previous.id === next.id) {
        return interaction.editReply({ content: say.error('`previous_rank` and `new_rank` are the same role. Nothing was changed.') });
      }
      // The @everyone role shares the server's id. It can be picked in a role option
      // but can never be given or taken away.
      if (previous.id === interaction.guild.id || next.id === interaction.guild.id) {
        return interaction.editReply({ content: say.error('@everyone is not a rank role. Pick the actual rank roles. Nothing was changed.') });
      }

      const member = await interaction.guild.members.fetch(target.id).catch(() => null);
      if (!member) return interaction.editReply({ content: say.error('That user is not in this server. Nothing was changed.') });

      // `editable` is false when the role is above the bot's own role or the bot lacks
      // Manage Roles. Compared to false on purpose: a role Discord did not fully send
      // has no such field, and that should not block a rank change.
      const locked = [next, previous].find((role) => role.editable === false);
      if (locked) {
        return interaction.editReply({
          content: say.error(`I cannot ${locked === next ? 'give' : 'take away'} **${locked.name}**: my bot role has to be ABOVE it and I need Manage Roles. Nothing was changed.`),
        });
      }

      const hadPrevious = member.roles.cache.has(previous.id);

      const progress = createInteractionProgress(interaction, `${k.verb === 'Promote' ? 'Promoting' : 'Demoting'} ${target.username}`, [
        `Set their roster title to **${title}**`,
        `Give them **${next.name}**`,
        `Take away **${previous.name}**`,
        `Log it in the ${k.logOption.replace('_channel', '')} channel`,
        'DM them',
      ]);

      return withProgress(async () => {
      await progress.start();
      let sheet;
      await progress.runStep(0, async () => {
        try {
          sheet = await getWriter().setRole({ discordId: target.id, title, section: department?.section });
        } catch (err) {
          throw new ProgressFailure(explain(err, `<@${target.id}>`));
        }
      });

      const why = `${k.verb} by ${issuer.username}: ${reason}`.slice(0, 500);
      await progress.runStep(1, async () => {
        try {
          await member.roles.add(next.id, why);
        } catch (err) {
          throw new ProgressFailure(`Their roster title is now **${title}**, but I could not give **${next.name}**: ${err.message}. They still have **${previous.name}**. Check my role position and Manage Roles, then run it again.`);
        }
      });

      let removeProblem = null;
      await progress.softStep(2, async () => {
        if (!hadPrevious) return true;
        try {
          await member.roles.remove(previous.id, why);
          return true;
        } catch (err) {
          removeProblem = `I gave them **${next.name}** but could not take away **${previous.name}**: ${err.message}.`;
          return false;
        }
      });

      const embed = rankChangeEmbed({ kind, target, previous, next, reason, issuer, title });
      const logged = await progress.softStep(3, () => postTo(interaction.client, hubSettings(interaction.guild.id)[k.logKey], {
        content: `<@${target.id}>`,
        embeds: [embed],
        allowedMentions: { users: [target.id] },
      }));
      const dmed = await progress.softStep(4, () => dm(target, embed));

      const was = sheet.previous && sheet.previous !== title ? ` (was ${sheet.previous})` : '';
      const lines = [
        say.ok(`${k.past} <@${target.id}> from <@&${previous.id}> to <@&${next.id}> and set their roster title to **${title}**${was} under **${labelFor(sheet.department)}**.`),
      ];
      if (!hadPrevious) lines.push(say.info(`They did not have <@&${previous.id}>, so there was nothing to take away.`));
      if (removeProblem) lines.push(say.warn(removeProblem));
      if (!logged) lines.push(say.warn(`Could not log it. Set ${k.logOption} with /config in the staff hub.`));
      if (!dmed) lines.push(say.warn('Their DMs are closed, so they were not told.'));
      await progress.complete(lines.join('\n'));
      });
    },
  };
}

module.exports = { rankCommand, KINDS };
