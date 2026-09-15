const { SlashCommandBuilder } = require('discord.js');
const { startHrCommand, explain } = require('../handlers/hrcommand');
const { getWriter, formatDate } = require('../handlers/rosterWriter');
const { byValue, hiringChoices } = require('../handlers/departments');
const { welcomeEmbed, dm } = require('../handlers/hrnotices');
const { pendingHire, clearPendingHire } = require('../handlers/botcomms');

// /hire [department] [sheet_rank] [rank] [user] [roblox_id] [nickname]
// Adds the person to the bottom of their department on the Official Staff Roster
// (Active, 0 stars, today's date, no warnings or infractions) with their title in
// the Roles column, gives them the rank role, then welcomes them in this channel
// with a link to the staff handbook and DMs them a copy.
//
// In a hiring ticket, the ticket bot has already sent bc!hire with the person's
// Discord ID, nickname and Roblox ID (handlers/botcomms.js). Run /hire in that
// ticket with only department, sheet_rank and rank, and the rest is filled in.
// Anything typed into user, roblox_id or nickname still wins, and the ticket's
// details are only ever used for the person they were sent about.
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
    .addUserOption((o) => o.setName('user').setDescription('The person being hired. Leave empty in a hiring ticket to use the ticket\'s details'))
    .addStringOption((o) => o.setName('roblox_id').setDescription('Their Roblox user ID. Leave empty in a hiring ticket to use the ticket\'s').setMaxLength(20))
    .addStringOption((o) => o
      .setName('nickname')
      .setDescription('Name for the roster. Leave empty to use the ticket\'s, or their name in this server')
      .setMaxLength(50)),

  async execute(interaction) {
    if (!(await startHrCommand(interaction))) return;

    const channelId = interaction.channelId || interaction.channel?.id;
    const pending = pendingHire(channelId);
    const picked = interaction.options.getUser('user');

    let target = picked;
    if (!target && pending) target = await interaction.client.users.fetch(pending.discordId).catch(() => null);
    if (!target) {
      return interaction.editReply({
        content: pending
          ? `The ticket bot sent a Discord ID (${pending.discordId}) that I cannot find. Pick the \`user\`. Nothing was changed.`
          : 'Pick the `user` to hire. In a hiring ticket this is filled in from the ticket bot\'s bc!hire, but there is none in this channel. Nothing was changed.',
      });
    }
    if (target.bot) return interaction.editReply({ content: 'Bots cannot be put on the staff roster.' });

    // The ticket's details only count for the person they were sent about.
    const ticket = pending && pending.discordId === target.id ? pending : null;

    const department = byValue(interaction.options.getString('department'));
    const title = interaction.options.getString('sheet_rank').trim();
    const rank = interaction.options.getRole('rank');
    const robloxId = (interaction.options.getString('roblox_id') || ticket?.robloxId || '').trim();
    if (robloxId && !/^\d+$/.test(robloxId)) {
      return interaction.editReply({ content: 'That Roblox ID is not a number. Leave it empty if you do not have it yet.' });
    }

    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!member) return interaction.editReply({ content: `<@${target.id}> is not in this server, so I cannot give them the rank role. Nothing was changed.` });

    // The @everyone role shares the server's id and can never be given.
    if (rank.id === interaction.guild.id) {
      return interaction.editReply({ content: '@everyone is not a rank role. Pick the actual rank role. Nothing was changed.' });
    }

    // See handlers/rankcommand.js: compared to false on purpose.
    if (rank.editable === false) {
      return interaction.editReply({ content: `I cannot give **${rank.name}**: my bot role has to be ABOVE it and I need Manage Roles. Nothing was changed.` });
    }

    const nickname = (interaction.options.getString('nickname') || ticket?.nickname || member.displayName || target.globalName || target.username).trim();

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

    // Used, so it is not kept a moment longer than needed.
    if (ticket) clearPendingHire(channelId);

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

    const lines = [roleProblem
      ? `Hired <@${target.id}> into **${department.label}** as **${title}** and added them to the roster.`
      : `Hired <@${target.id}> into **${department.label}** as **${title}**, gave them <@&${rank.id}>, and added them to the roster.`];
    if (ticket) lines.push(`Used the ticket bot's details: nickname **${nickname}**${robloxId ? `, Roblox ID ${robloxId}` : ''}.`);
    if (pending && !ticket) lines.push(`This ticket's bc!hire details are for <@${pending.discordId}>, not them, so they were not used.`);
    if (roleProblem) lines.push(roleProblem);
    if (!posted) lines.push('I could not post the welcome message in this channel.');
    if (!dmed) lines.push('Their DMs are closed, so they did not get a copy of the welcome.');
    return interaction.editReply({ content: lines.join('\n'), allowedMentions: { parse: [] } });
  },
};
