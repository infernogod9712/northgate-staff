// forcerestart.js
// d!forcerestart ops: restarts Staff Management. Each NorthGate bot answers only to
// its own name (core = NorthGate OS, ops = Staff Management, shield = North
// Shield). PM2 starts the process again after it exits.

const { isOwner } = require('./permissions');
const { say } = require('./progress');

const TARGET = 'ops';

function isRestart(content) {
  const [command, target] = content.trim().toLowerCase().split(/\s+/);
  return command === 'd!forcerestart' && target === TARGET;
}

async function forceRestart(message) {
  if (!isOwner(message.author.id)) {
    await message.reply(say.error('Only the bot owners can restart Staff Management.')).catch(() => {});
    return;
  }
  await message.reply('🔄 Restarting **Staff Management**...').catch(() => {});
  console.log(`[forcerestart] restart requested by ${message.author.tag}`);
  await message.client.destroy();
  process.exit(0);
}

module.exports = { isRestart, forceRestart };
