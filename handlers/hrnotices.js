// hrnotices.js
// What the HR commands say in Discord: the welcome message, the staff action
// embeds, and where they get posted.
//
// Posting and DMing never throw. A closed DM or a missing log channel is reported
// back to the person who ran the command, and never undoes a roster change that
// has already been made.

const { EmbedBuilder, escapeMarkdown } = require('discord.js');
const config = require('../config');
const { COLORS } = require('./embeds');
const { hubSettings } = require('./settings');

function welcomeEmbed({ user, nickname, department, role, hiredBy }) {
  return new EmbedBuilder()
    .setColor(COLORS.promote)
    .setTitle(`Welcome to the team, ${nickname}!`.slice(0, 256))
    .setThumbnail(user.displayAvatarURL?.() ?? null)
    .setDescription([
      `Hey <@${user.id}>, welcome to the **NorthGate Studios** staff team!`,
      '',
      `You are joining **${escapeMarkdown(department)}** as **${escapeMarkdown(role)}**. Before you get started, please read through the [staff handbook](${config.handbookUrl}). It covers how we work and what we expect from everyone on the team.`,
      '',
      'We are really glad to have you here, and we hope you make great contributions to our team.',
    ].join('\n'))
    .addFields(
      { name: 'Department', value: department, inline: true },
      { name: 'Role', value: role.slice(0, 1024), inline: true },
      { name: 'Hired by', value: `<@${hiredBy.id}>`, inline: true },
    )
    .setFooter({ text: 'NorthGate Studios Staff Team' })
    .setTimestamp();
}

function actionEmbed({ title, color, target, message, fields = [], by }) {
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setThumbnail(target.displayAvatarURL?.() ?? null)
    .addFields(
      { name: 'Staff Member', value: `<@${target.id}>`, inline: true },
      ...fields.map((f) => ({ ...f, value: String(f.value).slice(0, 1024) })),
      { name: 'Issued by', value: `<@${by.id}>`, inline: true },
    )
    .setTimestamp();
  if (message) embed.setDescription(message);
  return embed;
}

async function postTo(client, channelId, payload) {
  if (!channelId) return false;
  try {
    const channel = await client.channels.fetch(channelId);
    await channel.send(payload);
    return true;
  } catch {
    return false;
  }
}

async function dm(user, embed) {
  try {
    await user.send({ embeds: [embed] });
    return true;
  } catch {
    return false;
  }
}

// Called by leave.js when an end date passes.
async function leaveEnded(client, { discordId, entry, outcome }) {
  const what = entry.status;
  const text = outcome === 'returned'
    ? `Their ${what} has ended, so their status is back to **Active**.`
    : outcome === 'wrong_status'
      ? `Their ${what} end date has passed, but their status had already been changed, so it was left as it is.`
      : `Their ${what} end date has passed, but they are no longer on the Official Staff Roster.`;

  const embed = new EmbedBuilder()
    .setColor(outcome === 'returned' ? COLORS.promote : COLORS.info)
    .setTitle('Leave Ended')
    .setDescription(`<@${discordId}>: ${text}`)
    .setTimestamp();
  await postTo(client, hubSettings().loaChannel, { embeds: [embed], allowedMentions: { parse: [] } });

  if (outcome === 'returned') {
    const user = await client.users.fetch(discordId).catch(() => null);
    if (user) {
      await dm(user, new EmbedBuilder()
        .setColor(COLORS.promote)
        .setTitle('Welcome back')
        .setDescription(`Your ${what} has ended and your status is back to Active. Welcome back to the team!`)
        .setTimestamp());
    }
  }
}

module.exports = { welcomeEmbed, actionEmbed, postTo, dm, leaveEnded };
