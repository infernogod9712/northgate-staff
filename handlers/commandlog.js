// commandlog.js
// Logs every command run in the staff hub or the main server to the main
// server's log channel, set with /config log_channel.
//
// The Arguments field shows what was typed into the command, the same as
// NorthGate OS's log (asked for on 2026-11-09). That includes HR text such as a
// /fire reason or an /addnote, so keep log_channel staff-only.
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

// Slash command options as NorthGate OS logs them: name=value, space separated.
function formatOptions(options = []) {
  return options.map((option) => `${option.name}=${option.value ?? (option.options || []).map((nested) => `${nested.name}=${nested.value ?? ''}`).join(',')}`);
}

function formatArguments(args) {
  if (args === undefined || args === null || args === '') return 'None';
  if (Array.isArray(args)) return args.length ? args.join(' ') : 'None';
  return String(args);
}

async function logCommand({ client, guild, channel, user, name, type = 'Slash command', args }) {
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

    const shown = type !== 'Slash command' && type !== 'Bot command' ? (name.includes('!') ? name : `!${name}`) : type === 'Bot command' ? `bc!${name}` : `/${name}`;
    const embed = new EmbedBuilder()
      .setColor(0x2b6cb0) // NorthGate OS's command log colour
      .setTitle('Command Used')
      .addFields(
        { name: 'Command', value: `\`${shown}\``, inline: true },
        { name: 'Type', value: type, inline: true },
        { name: 'Arguments', value: `\`${formatArguments(args).replace(/`/g, "'").slice(0, 1020)}\``, inline: false },
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

module.exports = { logCommand, formatOptions };
