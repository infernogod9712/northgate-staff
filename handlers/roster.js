// roster.js
// Turns the four roster columns into the two lists HR asked for:
//
//   low    anyone at or below 3 stars on Performance
//   leave  anyone on Leave of Absence, Reduced Activity or Administrative Leave
//
// No network and no Discord here, only data in and lists out, so every rule
// below is tested directly in tools/check.js.
//
// HOW THE ROSTER IS LAID OUT, measured against the real sheet on 2026-09-13
//
//   - A department header is a row with a nickname and NO employment status.
//     There were exactly 8 of them, one per department. Everything under one
//     belongs to that department until the next.
//   - A blank row has no nickname. Skipped.
//   - Performance is a number from 0 to 5. A 0 is an empty star rating, which
//     means nobody has rated them yet, not that they scored zero.
//   - Some people are listed in more than one department, sometimes with a
//     different rating in each.

const SNOWFLAKE = /^\d{17,20}$/;
const LOW_MAX = 3;

// The sheet's own spelling is "Leave of Absense". Both spellings are matched so
// that fixing the typo in the sheet one day does not silently empty the list.
const LEAVE = {
  'leave of absense': 'Leave of Absence',
  'leave of absence': 'Leave of Absence',
  'reduced activity': 'Reduced Activity',
  'administrative leave': 'Administrative Leave',
};
const LEAVE_ORDER = ['Leave of Absence', 'Reduced Activity', 'Administrative Leave'];

const clean = (value) => (value === undefined || value === null ? '' : String(value).trim());

function readRating(value) {
  const text = clean(value);
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return n >= 0 && n <= 5 ? n : null;
}

const byName = (a, b) => a.nickname.localeCompare(b.nickname, undefined, { sensitivity: 'base' });

function summarize(columns) {
  const nicknames = columns.nickname || [];
  const ids = columns.discordId || [];
  const ratings = columns.performance || [];
  const statuses = columns.status || [];
  const length = Math.max(nicknames.length, ids.length, ratings.length, statuses.length);

  // One entry per person. Keyed by Discord ID where the roster has a real one,
  // otherwise by nickname, so someone listed in two departments appears once.
  const people = new Map();
  let department = null;
  let departments = 0;

  for (let r = 0; r < length; r += 1) {
    const nickname = clean(nicknames[r]);
    const status = clean(statuses[r]);
    if (!nickname) continue;
    if (!status) {
      department = nickname;
      departments += 1;
      continue;
    }

    const id = clean(ids[r]);
    const discordId = SNOWFLAKE.test(id) ? id : null;
    const key = discordId ? `id:${discordId}` : `name:${nickname.toLowerCase()}`;
    if (!people.has(key)) people.set(key, { nickname, discordId, rows: [] });
    people.get(key).rows.push({ department, rating: readRating(ratings[r]), status });
  }

  const low = [];
  const leave = [];

  for (const person of people.values()) {
    const base = { nickname: person.nickname, discordId: person.discordId };

    // A real rating anywhere wins over an unrated row, so an empty rating in a
    // second department can never hide a low one in the first.
    const rated = person.rows.filter((row) => row.rating !== null && row.rating > 0);
    if (rated.length) {
      const worst = rated.reduce((a, b) => (b.rating < a.rating ? b : a));
      if (worst.rating <= LOW_MAX) low.push({ ...base, rating: worst.rating, department: worst.department });
    } else {
      const unrated = person.rows.find((row) => row.rating === 0);
      if (unrated) low.push({ ...base, rating: 0, department: unrated.department });
    }

    const away = person.rows.find((row) => LEAVE[row.status.toLowerCase()]);
    if (away) leave.push({ ...base, status: LEAVE[away.status.toLowerCase()], department: away.department });
  }

  // Lowest real rating first, then the unrated at the bottom.
  low.sort((a, b) => {
    const ra = a.rating === 0 ? 99 : a.rating;
    const rb = b.rating === 0 ? 99 : b.rating;
    return ra - rb || byName(a, b);
  });
  leave.sort((a, b) => LEAVE_ORDER.indexOf(a.status) - LEAVE_ORDER.indexOf(b.status) || byName(a, b));

  return { low, leave, people: people.size, departments };
}

module.exports = { summarize, LOW_MAX };
