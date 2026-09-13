const { SlashCommandBuilder } = require('discord.js');
const { startHrCommand, explain } = require('../handlers/hrcommand');
const { getWriter, formatDate } = require('../handlers/rosterWriter');
const { byValue, hiringChoices } = require('../handlers/departments');
const { welcomeEmbed, dm } = require('../handlers/hrnotices');

// /hire [user] [department] [sheet_rank] [rank] [roblox_id] [nickname]
// Adds the person to the bottom of their department on the Official Staff Roster
// (Active, 0 stars, today's date, no warnings or infractions) with their title in
// the Roles column, gives them the rank role, then welcomes them in this channel
// with a link to the staff handbook and DMs them a copy.
//
// sheet_rank and rank match /promote on purpose: one name for one idea across the
// commands HR uses together.
//
// Checked before anything changes: they are in this server, and the bot is allowed
// to give that role. Then the roster, then the role, then the welcome. Nobody is
// welcomed unless they made it onto the roster, because a welcome for someone who
// is not on it is exactly the mismatch HR would then have to find by hand.
module.exports = {
  data: new SlashCommandBuilder()
    .setName('hire')
    .setDescription('Hire someone onto the staff team: roster, rank role, and a welcome')
    .addUserOption((o) => o.setName('user').setDescription('The person being hired').setRequired(true))
    .addStringOption((o) => o
      .setName('department')
      .setDescription('The department they are joining')
      .setRequired(true)
      .addChoices(...hiringChoices()))
    .addStringOption((o) => o
      .setName('sheet_rank')
      .setDescription('Their title on the roster, for example Community Staff')
      .setRequired(true)
      .setMaxLength(100))
    .addRoleOption((o) => o.setName('rank').setDescription('The rank role to give them').setRequired(true))
    .addStringOption((o) => o.setName('roblox_id').setDescription('Their Roblox user ID, if you have it').setMaxLength(20))
    .addStringOption((o) => o
      .setName('nickname')
      .setDescription('Name for the roster. Leave empty to use their name in this server')
      .setMaxLength(50)),

  async execute(interaction) {
    if (!(await startHrCommand(interaction))) return;

    const target = interaction.options.getUser('user');
    if (target.bot) return interaction.editReply({ content: 'Bots cannot be put on the staff roster.' });

    const department = byValue(interaction.options.getString('department'));
    const title = interaction.options.getString('sheet_rank').trim();
    const rank = interaction.options.getRole('rank');
    const robloxId = (interaction.options.getString('roblox_id') || '').trim();
    if (robloxId && !/^\d+$/.test(robloxId)) {
      return interaction.editReply({ content: 'That Roblox ID is not a number. Leave it empty if you do not have it yet.' });
    }

    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!member) return interaction.editReply({ content: 'That user is not in this server, so I cannot give them the rank role. Nothing was changed.' });

    // The @everyone role shares the server's id and can never be given.
    if (rank.id === interaction.guild.id) {
      return interaction.editReply({ content: '@everyone is not a rank role. Pick the actual rank role. Nothing was changed.' });
    }

    // See handlers/rankcommand.js: compared to false on purpose.
    if (rank.editable === false) {
      return interaction.editReply({ content: `I cannot give **${rank.name}**: my bot role has to be ABOVE it and I need Manage Roles. Nothing was changed.` });
    }

    const nickname = (interaction.options.getString('nickname') || member.displayName || target.globalName || target.username).trim();

    try {
      await getWriter().hire({
        nickname,
        discordId: target.id,
        robloxId,
        role: title,
        section: department.section,
        date: formatDate(Date.now()),
      });
    } catch (err) {
      return interaction.editReply({ content: explain(err, `<@${target.id}>`) });
    }

    let roleProblem = null;
    try {
      await member.roles.add(rank.id, `Hired by ${interaction.user.username} into ${department.label}`);
    } catch (err) {
      roleProblem = `They are on the roster, but I could not give them **${rank.name}**: ${err.message}.`;
    }

    const embed = welcomeEmbed({ user: target, nickname, department: department.label, role: title, hiredBy: interaction.user });
    const posted = interaction.channel
      ? await interaction.channel
        .send({ content: `<@${target.id}>`, embeds: [embed], allowedMentions: { users: [target.id] } })
        .then(() => true, () => false)
      : false;
    const dmed = await dm(target, embed);
    require('../handlers/hrpanel').refreshSoon();

    const lines = [`Hired <@${target.id}> into **${department.label}** as **${title}**, gave them <@&${rank.id}>, and added them to the roster.`];
    if (roleProblem) lines[0] = `Hired <@${target.id}> into **${department.label}** as **${title}** and added them to the roster.`;
    if (roleProblem) lines.push(roleProblem);
    if (!posted) lines.push('I could not post the welcome message in this channel.');
    if (!dmed) lines.push('Their DMs are closed, so they did not get a copy of the welcome.');
    return interaction.editReply({ content: lines.join('\n') });
  },
};
