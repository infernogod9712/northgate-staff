// Reads the secrets out of .env so nothing sensitive lives in a tracked file.
require('dotenv').config();
const path = require('path');

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
  // The Google Sheets staff roster the HR panel reads. The sheet id is not a
  // secret: nobody can open the sheet without it being shared with them. The key
  // file IS a secret, is gitignored, and has to be copied onto the Pi by hand.
  roster: {
    sheetId: process.env.ROSTER_SHEET_ID || '1zgKYe984COJd25PktpU7mmaPD0ikvKa0vOincAjWVRg',
    tab: process.env.ROSTER_TAB || 'OFFICAL STAFF ROSTER',
    formerTab: process.env.ROSTER_FORMER_TAB || 'FORMER STAFF ROSTER',
    credentialsFile: process.env.GOOGLE_CREDENTIALS_FILE || path.join(__dirname, 'credentials.json'),
  },
  // Linked from the /hire welcome message.
  handbookUrl: process.env.STAFF_HANDBOOK_URL
    || 'https://docs.google.com/document/d/1vZx8tigurY7glO708EA4MByUBj-mORu_FrLJ_tTajAY/edit?usp=drivesdk',
  hrPanel: {
    intervalSeconds: Number(process.env.HR_PANEL_INTERVAL) || 30,
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
