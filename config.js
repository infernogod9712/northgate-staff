// Reads the secrets out of .env so nothing sensitive lives in a tracked file.
require('dotenv').config();

// Both owners, with blanks and unfilled placeholders dropped. Stored as one array
// so every owner check is just `ownerIds.includes(id)` no matter how many there are.
const ownerIds = [process.env.OWNER_ID_1, process.env.OWNER_ID_2]
  .filter((id) => id && !id.startsWith('PUT_'));

const config = {
  token:    process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  ownerIds,
  gitSync: {
    enabled: true,
    intervalSeconds: Number(process.env.GIT_SYNC_INTERVAL) || 30,
  },
};

// Fail loudly at startup instead of with a confusing login error later.
if (!config.token || config.token.startsWith('PUT_')) {
  console.error('[NGS] .env is missing DISCORD_TOKEN. Fill it in before starting the bot.');
  process.exit(1);
}
if (!ownerIds.length) {
  console.error('[NGS] .env has no owner ids. Set OWNER_ID_1 (and OWNER_ID_2) before starting the bot.');
  process.exit(1);
}

module.exports = config;
