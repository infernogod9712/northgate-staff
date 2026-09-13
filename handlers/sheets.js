// sheets.js
// Reads the NGC staff roster out of Google Sheets, signed in as the service
// account in credentials.json.
//
// WHY NO GOOGLE PACKAGE
//
// Signing in is one RS256 signature, which Node's built-in crypto already does.
// Adding googleapis would mean package.json changes, and on the Pi git-sync runs
// npm install when that happens and then restarts the bot even if the install
// failed. A module that failed to install is a crash on require, so every
// restart after that would crash too. Nothing to install means nothing to fail.
//
// WHAT IT ASKS FOR
//
// Four columns, found by their header names: nickname, Discord ID, Performance
// and Employment Status. The roster also holds Infractions and Notes columns with
// genuinely sensitive information in them. The bot has no reason to read those,
// so it never requests them at all. Columns are found by header on every read,
// so if HR inserts or moves a column the bot follows it instead of quietly
// reading whatever column now sits in the old position.
//
// Everything is read as FORMATTED_VALUE. A Discord ID stored as a number is 18
// or 19 digits, which is more than a JavaScript number holds exactly, so reading
// the raw number would silently change the last digits and mention the wrong
// person.

const fs = require('fs');
const crypto = require('crypto');

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const HEADER_SCAN_ROWS = 10;

// field -> how its header is matched. Exact where the header is plain text,
// "contains" where the sheet may put an icon in front of it.
const COLUMNS = {
  nickname: { header: 'nickname', exact: true },
  discordId: { header: 'discord id', exact: true },
  performance: { header: 'performance', exact: false },
  status: { header: 'employment status', exact: false },
};

function columnLetter(index) {
  let out = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
  }
  return out;
}

function createRosterReader({ credentialsFile, sheetId, tab, fetchImpl = (...args) => fetch(...args), now = () => Date.now() }) {
  let token = null;
  let tokenExpires = 0;

  function isConfigured() {
    if (!sheetId || !tab) return false;
    try {
      fs.accessSync(credentialsFile);
      return true;
    } catch {
      return false;
    }
  }

  // Errors here say what is wrong in plain words and never include any part of
  // the key. They end up in panel embeds and in the Pi's logs.
  function loadKey() {
    let raw;
    try {
      raw = fs.readFileSync(credentialsFile, 'utf8');
    } catch {
      throw new Error('credentials.json is not in the bot folder');
    }
    let key;
    try {
      key = JSON.parse(raw);
    } catch {
      throw new Error('credentials.json is not valid JSON');
    }
    if (!key.client_email || !key.private_key) throw new Error('credentials.json is not a service account key');
    return key;
  }

  async function accessToken() {
    if (token && now() < tokenExpires - 60_000) return token;

    const key = loadKey();
    const audience = key.token_uri || 'https://oauth2.googleapis.com/token';
    const b64 = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
    const issuedAt = Math.floor(now() / 1000);
    const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
      iss: key.client_email,
      scope: SCOPE,
      aud: audience,
      iat: issuedAt,
      exp: issuedAt + 3600,
    })}`;

    let signature;
    try {
      signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(key.private_key).toString('base64url');
    } catch {
      throw new Error('the key in credentials.json could not sign in');
    }

    const res = await fetchImpl(audience, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${unsigned}.${signature}`,
      }),
    });
    if (!res.ok) throw new Error(`Google refused the service account sign-in (HTTP ${res.status})`);

    const body = await res.json();
    token = body.access_token;
    tokenExpires = now() + (Number(body.expires_in) || 3600) * 1000;
    return token;
  }

  async function api(path) {
    const res = await fetchImpl(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}${path}`, {
      headers: { authorization: `Bearer ${await accessToken()}` },
    });
    if (res.status === 401) token = null;
    if (res.ok) return res.json();
    if (res.status === 403) throw new Error('the roster is not shared with the service account');
    if (res.status === 404) throw new Error('the roster sheet or tab could not be found');
    if (res.status === 429) throw new Error('Google is rate limiting the roster reads');
    throw new Error(`Google Sheets returned HTTP ${res.status}`);
  }

  const range = (a1) => encodeURIComponent(`'${tab.replace(/'/g, "''")}'!${a1}`);

  async function findLayout() {
    const body = await api(`/values/${range(`1:${HEADER_SCAN_ROWS}`)}?valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS`);
    const rows = body.values || [];

    for (let r = 0; r < rows.length; r += 1) {
      const cells = rows[r].map((c) => String(c ?? '').trim().toLowerCase());
      if (!cells.includes(COLUMNS.discordId.header)) continue;

      const cols = {};
      const missing = [];
      for (const [field, { header, exact }] of Object.entries(COLUMNS)) {
        const index = exact ? cells.indexOf(header) : cells.findIndex((c) => c.includes(header));
        if (index === -1) missing.push(header);
        cols[field] = index;
      }
      if (missing.length) throw new Error(`the roster header row is missing: ${missing.join(', ')}`);
      return { firstDataRow: r + 2, cols };
    }
    throw new Error(`no "Discord ID" header in the first ${HEADER_SCAN_ROWS} rows of the roster`);
  }

  // Returns { nickname: [], discordId: [], performance: [], status: [] }, each one
  // column from the first row under the header, so index i is the same row in all
  // four.
  async function readRoster() {
    const { firstDataRow, cols } = await findLayout();
    const fields = Object.keys(COLUMNS);
    const ranges = fields
      .map((field) => {
        const letter = columnLetter(cols[field]);
        return `ranges=${range(`${letter}${firstDataRow}:${letter}`)}`;
      })
      .join('&');

    const body = await api(`/values:batchGet?${ranges}&valueRenderOption=FORMATTED_VALUE&majorDimension=COLUMNS`);
    const out = {};
    fields.forEach((field, i) => {
      out[field] = body.valueRanges?.[i]?.values?.[0] || [];
    });
    return out;
  }

  return { isConfigured, readRoster };
}

module.exports = { createRosterReader, columnLetter };
