// rosterWriter.js
// Every change the bot makes to the Employee Database goes through here.
//
// THE RULES IT FOLLOWS, and why
//
// Never trust a remembered row number. People hire, fire and edit the sheet by
// hand, and every insert or delete moves every row under it. So each operation
// re-reads the table right before it writes, and finds the person by Discord ID
// rather than by position.
//
// One operation, one batch. A /fire copies rows into the Former roster and
// deletes them from the Official one. Google applies a batchUpdate all at once or
// not at all, so a failure halfway can never leave someone on both tabs or on
// neither.
//
// One operation at a time. Two HR members running commands in the same second
// would otherwise both read the same row numbers and then both write, and the
// second write would land on a row the first had already moved. Every operation
// waits for the one before it.
//
// Exact dropdown text, read from the sheet. The status dropdown's options include
// "Active " and "Reduced Activity " with trailing spaces, and "Leave of Absense"
// spelled that way. Google does not reject a near miss: it stores it silently and
// the chip just stops matching. So the option text is read from the table's own
// definition instead of being typed into this file.
//
// Typed values. A Discord ID is written as text, never a number, because a
// 19-digit number cannot be stored exactly. Ratings are written as numbers,
// because that is what the star chips read.

const { createSheetsClient, columnLetter, READ_WRITE } = require('./sheets');
const { squash } = require('./departments');

// field -> the table column's name, compared after squashing ("Roles " -> "roles")
const FIELDS = {
  nickname: 'nickname',
  discordId: 'discord id',
  robloxId: 'roblox id',
  roles: 'roles',
  performance: 'performance',
  activity: 'activity',
  status: 'employment status',
  dateHired: 'date hired',
  warnings: 'warnings',
  infractions: 'infractions',
  notes: 'notes',
};

class RosterError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

// The sheet spells it "Leave of Absense". Everything else in the bot spells it
// correctly, and both have to match the same dropdown option.
const canon = (text) => squash(text).replace('absense', 'absence');

// A Warnings or Infractions cell that says any of these holds nothing yet, so the
// first real entry replaces it instead of being appended under "None".
const EMPTY_WORDS = new Set(['', 'none', 'n/a', 'na', '-']);

function formatDate(ms) {
  return new Date(ms).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

function createRosterWriter({ credentialsFile, sheetId, officialTab, formerTab, fetchImpl, now }) {
  const api = createSheetsClient({ credentialsFile, sheetId, scope: READ_WRITE, fetchImpl, now });

  let queue = Promise.resolve();
  function serial(task) {
    const run = queue.then(task, task);
    queue = run.then(() => {}, () => {});
    return run;
  }

  // -------------------------------------------------------------------------
  // Reading the layout
  // -------------------------------------------------------------------------

  async function tables() {
    const meta = await api.get('?fields=sheets(properties(sheetId,title),tables(name,range,columnProperties(columnIndex,columnName,dataValidationRule)))');

    const describe = (title) => {
      const sheet = (meta.sheets || []).find((s) => s.properties.title === title);
      if (!sheet) throw new RosterError('layout', `the "${title}" tab is missing from the Employee Database`);
      const table = (sheet.tables || [])[0];
      if (!table) throw new RosterError('layout', `the "${title}" tab has no table in it`);

      const start = table.range.startColumnIndex || 0;
      const cols = {};
      const options = {};
      for (const column of table.columnProperties || []) {
        const field = Object.keys(FIELDS).find((f) => FIELDS[f] === squash(column.columnName));
        if (!field) continue;
        cols[field] = start + (column.columnIndex || 0);
        const values = (column.dataValidationRule?.condition?.values || [])
          .map((v) => v.userEnteredValue)
          .filter((v) => typeof v === 'string');
        if (values.length) options[field] = values;
      }

      const missing = Object.keys(FIELDS).filter((f) => cols[f] === undefined);
      if (missing.length) {
        throw new RosterError('layout', `the "${title}" table is missing the ${missing.map((f) => FIELDS[f]).join(', ')} column`);
      }

      return {
        title,
        sheetId: sheet.properties.sheetId,
        cols,
        options,
        width: Math.max(...Object.values(cols)) + 1,
        firstRow: table.range.startRowIndex + 2, // the header is the table's first row
        lastRow: table.range.endRowIndex,
      };
    };

    return { official: describe(officialTab), former: describe(formerTab) };
  }

  function exactOption(t, field, wanted) {
    const list = t.options[field];
    if (!list) return wanted;
    const hit = list.find((option) => canon(option) === canon(wanted));
    if (hit === undefined) {
      throw new RosterError('layout', `"${wanted}" is not one of the ${FIELDS[field]} options on the "${t.title}" tab`);
    }
    return hit;
  }

  // Every row of a table, classified. A department header is a row with a
  // nickname and no status. A blank row has neither a nickname nor a Discord ID
  // (placeholder rows still show empty star ratings, so "every cell empty" is not
  // a usable test).
  async function readRows(t) {
    const a1 = `'${t.title.replace(/'/g, "''")}'!A${t.firstRow}:${columnLetter(t.width - 1)}${t.lastRow}`;
    const body = await api.get(`?ranges=${encodeURIComponent(a1)}&includeGridData=true&fields=sheets(data(rowData(values(userEnteredValue,formattedValue))))`);
    const data = body.sheets?.[0]?.data?.[0]?.rowData || [];

    const rows = [];
    let department = null;
    for (let i = 0; i <= t.lastRow - t.firstRow; i += 1) {
      const cells = data[i]?.values || [];
      const text = (field) => String(cells[t.cols[field]]?.formattedValue ?? '').trim();
      const nickname = text('nickname');
      const discordId = text('discordId');
      const status = text('status');
      const row = { row: t.firstRow + i, cells, department };

      if (!nickname && !discordId) {
        row.kind = 'blank';
      } else if (!status) {
        row.kind = 'section';
        department = nickname;
        row.department = nickname;
      } else {
        Object.assign(row, { kind: 'person', nickname, discordId, status });
      }
      rows.push(row);
    }
    return rows;
  }

  function personRows(rows, discordId, section) {
    const mine = rows.filter((r) => r.kind === 'person' && r.discordId === discordId);
    if (!mine.length) throw new RosterError('not_on_roster', 'they are not on the Official Staff Roster');
    if (!section) return mine;
    const inSection = mine.filter((r) => squash(r.department) === squash(section));
    if (!inSection.length) {
      throw new RosterError('not_in_department', 'they are not listed under that department', { departments: mine.map((r) => r.department) });
    }
    return inSection;
  }

  // -------------------------------------------------------------------------
  // Request builders
  // -------------------------------------------------------------------------

  const text = (value) => (value === '' || value === null || value === undefined ? {} : { userEnteredValue: { stringValue: String(value) } });
  const number = (value) => ({ userEnteredValue: { numberValue: value } });
  const cellsAt = (t, row, column, cells) => ({
    updateCells: { rows: [{ values: cells }], fields: 'userEnteredValue', start: { sheetId: t.sheetId, rowIndex: row - 1, columnIndex: column } },
  });
  const insertRow = (t, row) => ({
    insertDimension: { range: { sheetId: t.sheetId, dimension: 'ROWS', startIndex: row - 1, endIndex: row }, inheritFromBefore: true },
  });
  const deleteRow = (t, row) => ({
    deleteDimension: { range: { sheetId: t.sheetId, dimension: 'ROWS', startIndex: row - 1, endIndex: row } },
  });
  function wholeRow(t, byField) {
    const cells = Array.from({ length: t.width }, () => ({}));
    for (const [field, cell] of Object.entries(byField)) cells[t.cols[field]] = cell;
    return cells;
  }

  // -------------------------------------------------------------------------
  // Operations
  // -------------------------------------------------------------------------

  // Adds a row at the bottom of a department. An empty placeholder row at the end
  // of that department is filled first, so the sheet does not keep growing extra
  // blank rows.
  function hire({ nickname, discordId, robloxId, role, section, date }) {
    return serial(async () => {
      const { official: t } = await tables();
      const rows = await readRows(t);

      const header = rows.find((r) => r.kind === 'section' && squash(r.department) === squash(section));
      if (!header) throw new RosterError('no_section', `there is no "${section}" section on the roster`);
      if (rows.some((r) => r.kind === 'person' && r.discordId === discordId && squash(r.department) === squash(section))) {
        throw new RosterError('already_listed', `they are already on the roster under ${header.department}`);
      }

      let lastPerson = null;
      let trailingBlank = null;
      for (let i = rows.indexOf(header) + 1; i < rows.length && rows[i].kind !== 'section'; i += 1) {
        if (rows[i].kind === 'person') {
          lastPerson = rows[i];
          trailingBlank = null;
        } else if (!trailingBlank) {
          trailingBlank = rows[i];
        }
      }

      const requests = [];
      let target;
      if (trailingBlank) {
        target = trailingBlank.row;
      } else {
        const after = (lastPerson || header).row;
        if (after < t.lastRow) {
          target = after + 1;
        } else if (lastPerson) {
          // The department runs to the very last row of the table. A row inserted
          // below the table would fall outside it and lose its dropdown and star
          // chips, so it goes in just above that last person instead: still inside
          // the table, still inside the right department.
          target = lastPerson.row;
        } else {
          throw new RosterError('no_section', `the "${header.department}" section has no room under it in the table`);
        }
        requests.push(insertRow(t, target));
      }

      requests.push(cellsAt(t, target, 0, wholeRow(t, {
        nickname: text(nickname),
        discordId: text(discordId),
        robloxId: text(robloxId),
        roles: text(role),
        performance: number(0),
        activity: number(0),
        status: text(exactOption(t, 'status', 'Active')),
        dateHired: text(date),
        warnings: text('None'),
        infractions: text('None'),
        notes: {},
      })));

      await api.batchUpdate(requests);
      return { row: target, department: header.department };
    });
  }

  // Moves every row someone has from the Official roster to the Former one, with
  // Retired or Terminated as their status and the reason added to their Notes.
  function fire({ discordId, type, reason, by, date }) {
    return serial(async () => {
      const { official: off, former } = await tables();
      const mine = personRows(await readRows(off), discordId);
      const formerRows = await readRows(former);
      const status = exactOption(former, 'status', type);

      const requests = [];
      let blanks = formerRows.filter((r) => r.kind === 'blank').map((r) => r.row);
      const needed = mine.length - blanks.length;
      if (needed > 0) {
        // Not enough empty rows in the Former table. New ones go in just above its
        // last row, which keeps them inside the table. Everything from that row
        // down moves by `needed`, including any blank that was already there.
        for (let k = 0; k < needed; k += 1) requests.push(insertRow(former, former.lastRow));
        blanks = blanks.map((r) => (r >= former.lastRow ? r + needed : r));
        for (let k = 0; k < needed; k += 1) blanks.push(former.lastRow + k);
        blanks.sort((a, b) => a - b);
      }

      mine.forEach((person, i) => {
        const copied = {};
        for (const field of Object.keys(FIELDS)) {
          const value = person.cells[off.cols[field]]?.userEnteredValue;
          copied[field] = value ? { userEnteredValue: value } : {};
        }
        const oldNotes = String(person.cells[off.cols.notes]?.formattedValue ?? '').trim();
        const line = `${date}: ${type} by ${by}. ${reason}`;
        copied.status = text(status);
        copied.notes = text(oldNotes && !EMPTY_WORDS.has(oldNotes.toLowerCase()) ? `${oldNotes}\n${line}` : line);
        requests.push(cellsAt(former, blanks[i], 0, wholeRow(former, copied)));
      });

      // Bottom-up, so deleting one row never moves the next one to be deleted.
      [...mine].sort((a, b) => b.row - a.row).forEach((person) => requests.push(deleteRow(off, person.row)));

      await api.batchUpdate(requests);

      // The batch is all-or-nothing, so this only fails if someone edited the sheet
      // by hand in the same moment. Worth saying out loud if it does.
      const after = await tables();
      const stillThere = (await readRows(after.official)).some((r) => r.kind === 'person' && r.discordId === discordId);
      const movedCount = (await readRows(after.former)).filter((r) => r.kind === 'person' && r.discordId === discordId).length;
      if (stillThere || movedCount < mine.length) {
        throw new RosterError('verify', 'the roster changed while they were being moved, so check both roster tabs', { moved: mine.length });
      }
      return { moved: mine.length, departments: mine.map((p) => p.department) };
    });
  }

  function setRating({ discordId, field, stars, section }) {
    if (field !== 'performance' && field !== 'activity') throw new Error(`not a rating column: ${field}`);
    return serial(async () => {
      const { official: t } = await tables();
      const mine = personRows(await readRows(t), discordId, section);
      if (mine.length > 1) {
        throw new RosterError('multiple_rows', 'they are listed in more than one department', { departments: mine.map((r) => r.department) });
      }
      await api.batchUpdate([cellsAt(t, mine[0].row, t.cols[field], [number(stars)])]);
      return { department: mine[0].department };
    });
  }

  // Status belongs to the person, not to one department row, so every row they
  // have is changed together. `onlyFrom` refuses unless their status is currently
  // one of those, which is what stops /unsuspend reactivating someone on leave.
  function setStatus({ discordId, status, onlyFrom }) {
    return serial(async () => {
      const { official: t } = await tables();
      const mine = personRows(await readRows(t), discordId);
      const current = [...new Set(mine.map((r) => r.status))];

      if (onlyFrom && !mine.every((r) => onlyFrom.some((s) => canon(s) === canon(r.status)))) {
        throw new RosterError('wrong_status', `their status is ${current.join(' / ')}`, { current });
      }
      if (mine.every((r) => canon(r.status) === canon(status))) {
        throw new RosterError('unchanged', `their status is already ${current.join(' / ')}`, { current });
      }

      const exact = exactOption(t, 'status', status);
      await api.batchUpdate(mine.map((r) => cellsAt(t, r.row, t.cols.status, [text(exact)])));
      return { previous: current, rows: mine.length };
    });
  }

  // Adds a line to Notes, Warnings or Infractions on every row the person has.
  // Never overwrites, except a cell that only says "None".
  function appendText({ discordId, field, line }) {
    if (!['notes', 'warnings', 'infractions'].includes(field)) throw new Error(`cannot add to ${field}`);
    return serial(async () => {
      const { official: t } = await tables();
      const mine = personRows(await readRows(t), discordId);
      await api.batchUpdate(mine.map((r) => {
        const old = String(r.cells[t.cols[field]]?.formattedValue ?? '').trim();
        return cellsAt(t, r.row, t.cols[field], [text(EMPTY_WORDS.has(old.toLowerCase()) ? line : `${old}\n${line}`)]);
      }));
      return { rows: mine.length };
    });
  }

  // The Roles column, which /promote and /hire call the sheet rank. Like a rating
  // it belongs to one department row, so someone listed in two departments needs
  // the department picked. Returns the old title so the reply can say what changed.
  function setRole({ discordId, title, section }) {
    return serial(async () => {
      const { official: t } = await tables();
      const mine = personRows(await readRows(t), discordId, section);
      if (mine.length > 1) {
        throw new RosterError('multiple_rows', 'they are listed in more than one department', { departments: mine.map((r) => r.department) });
      }
      const previous = String(mine[0].cells[t.cols.roles]?.formattedValue ?? '').trim();
      await api.batchUpdate([cellsAt(t, mine[0].row, t.cols.roles, [text(title)])]);
      return { previous, department: mine[0].department };
    });
  }

  return { isConfigured: api.isConfigured, hire, fire, setRating, setRole, setStatus, appendText };
}

// The running bot has one writer, so its queue really does cover every command.
let writer = null;

function getWriter() {
  if (!writer) {
    const config = require('../config');
    writer = createRosterWriter({
      credentialsFile: config.roster.credentialsFile,
      sheetId: config.roster.sheetId,
      officialTab: config.roster.tab,
      formerTab: config.roster.formerTab,
    });
  }
  return writer;
}

// Tests swap in a writer pointed at a fake sheet.
function setWriter(replacement) {
  writer = replacement;
}

module.exports = { createRosterWriter, RosterError, getWriter, setWriter, formatDate, FIELDS };
