// ping.js
// n!ping, answered by every NorthGate bot with the same embed NorthGate OS
// uses, plus the bot's name in the footer so replies can be told apart.

const { EmbedBuilder } = require('discord.js');

function isPing(content) {
  return content.trim().toLowerCase() === 'n!ping';
}

async function replyPing(message) {
  const latency = Date.now() - message.createdTimestamp;
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('🏓 Pong!')
    .setDescription(`Latency: **${latency}ms**`)
    .setFooter({ text: message.client.user.username })
    .setTimestamp();
  await message.reply({ embeds: [embed] });
}

module.exports = { isPing, replyPing };
