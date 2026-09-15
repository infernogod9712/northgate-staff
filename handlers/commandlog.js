// commandlog.js
// Logs every command run in the staff hub or the main server to the main
// server's log channel, set with /config log_channel.
//
// Only the command's NAME is logged, never what was typed into it. A /fire reason
// or an /addnote is HR information, and a log channel is not where it belongs.
//
// Logging never gets in the way of the command itself: it is not awaited by the
// caller, and a missing or broken log channel is warned about once, not on every
// command.

const { EmbedBuilder, escapeMarkdown } = require('discord.js');
const { getServers, getSettings } = require('./settings');
const { COLORS } = require('./embeds');

let warned = false;
const warnOnce = (message) => {
  if (warned) return;
  warned = true;
  console.warn(`[commandlog] ${message}`);
};

async function logCommand({ client, guild, channel, user, name, type = 'Slash command' }) {
  try {
    if (!guild) return false;
    const { main, hub } = getServers();
    if (!main || (guild.id !== main && guild.id !== hub)) return false;

    const { logChannel } = getSettings(main);
    if (!logChannel) return false;

    const target = await client.channels.fetch(logChannel).catch(() => null);
    if (!target || typeof target.send !== 'function') {
      warnOnce(`log channel ${logChannel} could not be found. Set log_channel again with /config in the main server.`);
      return false;
    }

    const shown = type === 'Prefix command' ? `!${name}` : type === 'Bot command' ? `bc!${name}` : `/${name}`;
    const embed = new EmbedBuilder()
      .setColor(COLORS.info)
      .setTitle('Command Used')
      .addFields(
        { name: 'Command', value: `\`${shown}\``, inline: true },
        { name: 'Type', value: type, inline: true },
        { name: 'User', value: `<@${user.id}> (${escapeMarkdown(user.username)})`, inline: false },
        { name: 'Channel', value: channel ? `<#${channel.id}>` : 'Unknown', inline: true },
        { name: 'Guild', value: escapeMarkdown(guild.name), inline: true },
      )
      .setTimestamp();

    await target.send({ embeds: [embed], allowedMentions: { parse: [] } });
    warned = false;
    return true;
  } catch (err) {
    warnOnce(`could not log a command: ${err.message}`);
    return false;
  }
}

module.exports = { logCommand };
