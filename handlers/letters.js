// letters.js
// The Employment Termination letter, filled in for one person.
//
// The design is NorthGate's own, made in Canva. The bot cannot drive Canva, so a
// blank export of it (assets/private/termination-template.png) is used as the
// page background and the details are typed onto it here. The placeholder text
// on the blank ("NAME HERE", "RANK", the X marks and so on) is covered with white
// first, then the real value is written where it sat.
//
// The template is NorthGate copyright and this repository is public, so it is
// gitignored and copied onto the Pi by hand. Without it, terminationLetter()
// returns null and /fire carries on exactly as before.
//
// Every position below is in pixels on the 1366 x 3489 template image, measured
// against a filled-in example made by HR in Canva. To move something, change its
// number in SPOTS and nothing else. Font sizes are worked out from the measured
// height of a capital letter, so they match the template's own text.

const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');

const ASSETS = path.join(__dirname, '..', 'assets');
// Read on every call so tests can point it at a stand-in template.
const templatePath = () => process.env.NGS_LETTER_TEMPLATE || path.join(ASSETS, 'private', 'termination-template.png');
const FONTS = {
  regular: path.join(ASSETS, 'fonts', 'DMSans-Regular.ttf'),
  bold: path.join(ASSETS, 'fonts', 'DMSans-Bold.ttf'),
  script: path.join(ASSETS, 'fonts', 'Sacramento-Regular.ttf'),
};

// Template image size, and the PDF page it becomes: US Letter width, the full
// length of the design on one long page, the way the Canva document is.
const IMAGE = { width: 1366, height: 3489 };
const SCALE = 612 / IMAGE.width;

// Capital letter height as a share of the font size, from each font's metrics.
const CAP = { regular: 0.7, bold: 0.7, script: 1550 / 2048, helvetica: 0.718 };

const INK = rgb(0.07, 0.07, 0.07);

// x: where the value starts. y: its baseline. cap: capital letter height in px.
// cover: the placeholder to white out first, [x0, y0, x1, y1].
const SPOTS = {
  status: { x: 176, y: 240, cap: 10, font: 'helvetica', cover: [172, 226, 330, 243] },
  update: { x: 174, y: 273, cap: 10.5, font: 'helvetica', cover: [172, 258, 330, 276] },
  to: { x: 85, y: 566, cap: 14, font: 'regular', cover: [83, 548, 210, 571], right: 760 },
  position: { x: 155, y: 608, cap: 14, font: 'regular', cover: [153, 590, 270, 612], right: 760 },
  subject: { x: 143, y: 687, cap: 14, font: 'regular', cover: [141, 669, 290, 691], right: 760 },
  appealable: { x: 181, y: 721, cap: 14, font: 'regular', cover: [178, 702, 222, 725], right: 760 },
  dear: { x: 80, y: 912, cap: 12, font: 'regular', cover: [78, 896, 140, 917], right: 760 },
  // The reason carries on from "...effective immediately, due to" on line two of
  // the overview, then wraps under it. Section A1.2 starts at y 1156.
  reason: { x: 484, y: 990, leftX: 34, right: 790, pitch: 27, lastY: 1130, cap: 12, font: 'regular', cover: [481, 974, 770, 1000] },
  // Both "Additional Statements Here" lines are always removed. A statement, if
  // given, fills the box beside the grey bar.
  statement: { x: 34, y: 2346, right: 790, pitch: 27, lastY: 2590, cap: 12, font: 'regular', cover: [30, 2322, 300, 2470] },
  effective: { x: 228, y: 2684, cap: 17, font: 'bold', right: 800 },
  issued: { x: 156, y: 2719, cap: 17, font: 'bold', right: 800 },
  authorized: { x: 223, y: 2754, cap: 17, font: 'bold', right: 800 },
  signed: { x: 97, y: 3009, cap: 15, font: 'bold', cover: [95, 2990, 235, 3015] },
};

// The three signature columns: the line runs x0..x1 at y 3140, the X mark sits
// above it and RANK below it.
const SIGNATURES = [
  { x0: 38, x1: 272, xMark: [128, 3055, 185, 3115] },
  { x0: 314, x1: 549, xMark: [404, 3055, 461, 3115] },
  { x0: 589, x1: 824, xMark: [680, 3055, 737, 3115] },
].map((s) => ({ ...s, cx: (s.x0 + s.x1) / 2, rankCover: [s.x0, 3146, s.x1, 3194] }));
const SIGNATURE_STYLE = { y: 3101, cap: 46 };
const RANK_STYLE = { y: 3176, cap: 15, small: 11, twoLineY: [3167, 3188] };

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function ordinal(n) {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'}`;
}

// "October 2nd, 2026", the way the example writes the effective date.
function longDate(ms) {
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${ordinal(d.getUTCDate())}, ${d.getUTCFullYear()}`;
}

// "10/02/2026", the MM/DD/YYYY the template asks for.
function shortDate(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${d.getUTCFullYear()}`;
}

// The embedded fonts cannot draw characters they do not have (some emoji in a
// nickname, for example), and pdf-lib throws on them. Anything the font lacks is
// dropped rather than failing the whole letter.
function drawable(font, value) {
  const set = new Set(font.getCharacterSet());
  return [...String(value ?? '')].filter((ch) => set.has(ch.codePointAt(0))).join('').replace(/\s+/g, ' ').trim();
}

function wrapLines(font, size, words, firstWidth, width) {
  const lines = [];
  let line = '';
  for (const word of words) {
    const tryLine = line ? `${line} ${word}` : word;
    const limit = lines.length === 0 ? firstWidth : width;
    if (font.widthOfTextAtSize(tryLine, size) <= limit || !line) {
      line = tryLine;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

async function terminationLetter(fields) {
  const TEMPLATE = templatePath();
  if (!fs.existsSync(TEMPLATE)) return null;

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(`NorthGate Studios Employment Termination: ${fields.name}`);
  pdf.setAuthor('NorthGate Studios');

  const fonts = {
    regular: await pdf.embedFont(fs.readFileSync(FONTS.regular), { subset: true }),
    bold: await pdf.embedFont(fs.readFileSync(FONTS.bold), { subset: true }),
    script: await pdf.embedFont(fs.readFileSync(FONTS.script), { subset: true }),
    helvetica: await pdf.embedFont(StandardFonts.HelveticaBold),
  };

  const page = pdf.addPage([IMAGE.width * SCALE, IMAGE.height * SCALE]);
  const image = await pdf.embedPng(fs.readFileSync(TEMPLATE));
  page.drawImage(image, { x: 0, y: 0, width: IMAGE.width * SCALE, height: IMAGE.height * SCALE });

  // Template pixels to PDF points. PDF y counts up from the bottom.
  const X = (px) => px * SCALE;
  const Y = (px) => (IMAGE.height - px) * SCALE;
  const sizeFor = (spot) => (spot.cap / CAP[spot.font]) * SCALE;

  const cover = ([x0, y0, x1, y1]) => page.drawRectangle({
    x: X(x0), y: Y(y1), width: X(x1 - x0), height: (y1 - y0) * SCALE, color: rgb(1, 1, 1),
  });

  // One line. Shrinks to fit before it would run past `right`.
  const write = (spot, value) => {
    if (spot.cover) cover(spot.cover);
    const font = fonts[spot.font];
    const text = spot.font === 'helvetica' ? String(value ?? '') : drawable(font, value);
    if (!text) return;
    let size = sizeFor(spot);
    if (spot.right) {
      const room = X(spot.right - spot.x);
      const width = font.widthOfTextAtSize(text, size);
      if (width > room) size *= room / width;
    }
    page.drawText(text, { x: X(spot.x), y: Y(spot.y), size, font, color: INK });
  };

  // A paragraph. The first line starts at spot.x, the rest at spot.leftX. If it
  // will not fit above spot.lastY, the size steps down until it does.
  const paragraph = (spot, value) => {
    if (spot.cover) cover(spot.cover);
    const font = fonts[spot.font];
    const words = drawable(font, value).split(' ').filter(Boolean);
    if (!words.length) return;
    const leftX = spot.leftX ?? spot.x;
    const maxLines = Math.floor((spot.lastY - spot.y) / spot.pitch) + 1;
    let size = sizeFor(spot);
    let pitch = spot.pitch;
    let lines = wrapLines(font, size, words, X(spot.right - spot.x), X(spot.right - leftX));
    while (lines.length * pitch > (spot.lastY - spot.y + spot.pitch) && size > sizeFor(spot) * 0.6) {
      size *= 0.92;
      pitch *= 0.92;
      lines = wrapLines(font, size, words, X(spot.right - spot.x), X(spot.right - leftX));
    }
    if (lines.length > maxLines / 0.6) lines.length = Math.floor(maxLines / 0.6);
    lines.forEach((line, i) => {
      page.drawText(line, { x: X(i === 0 ? spot.x : leftX), y: Y(spot.y + i * pitch), size, font, color: INK });
    });
  };

  const centered = (font, value, cx, baseline, size, maxWidth) => {
    const text = drawable(font, value);
    if (!text) return;
    let s = size;
    const width = font.widthOfTextAtSize(text, s);
    if (width > X(maxWidth)) s *= X(maxWidth) / width;
    page.drawText(text, { x: X(cx) - font.widthOfTextAtSize(text, s) / 2, y: Y(baseline), size: s, font, color: INK });
  };

  const date = fields.date ?? Date.now();
  const signer = (p) => (p ? (p.title ? `${p.name}, ${p.title}` : p.name) : '');
  const name = fields.username && fields.username.toLowerCase() !== String(fields.name).toLowerCase()
    ? `${fields.name} (${fields.username})`
    : fields.name;
  // The sentence it finishes needs a full stop, and a reason typed with a
  // trailing comma or semicolon should not end ",.".
  let reason = String(fields.reason || '').trim().replace(/[\s,;:]+$/, '');
  if (reason && !/[.!?]$/.test(reason)) reason += '.';

  write(SPOTS.status, 'ACTIVE');
  write(SPOTS.update, shortDate(date));
  write(SPOTS.to, name);
  write(SPOTS.position, fields.title || 'Staff Member');
  write(SPOTS.subject, 'TERMINATION OF EMPLOYMENT');
  write(SPOTS.appealable, fields.appealable || 'No');
  write(SPOTS.dear, `${fields.name},`);
  paragraph(SPOTS.reason, reason);
  paragraph(SPOTS.statement, fields.statement || '');
  write(SPOTS.effective, longDate(date));
  write(SPOTS.issued, signer(fields.issuer));
  write(SPOTS.authorized, signer(fields.authorizer));
  write(SPOTS.signed, shortDate(date));

  // Signatures: issued by, authorized by, then the optional third. A column with
  // nobody in it keeps its X and RANK, so it can still be signed by hand.
  [fields.issuer, fields.authorizer, fields.cosigner].forEach((person, i) => {
    if (!person) return;
    const col = SIGNATURES[i];
    cover(col.xMark);
    cover(col.rankCover);
    const width = col.x1 - col.x0;
    centered(fonts.script, person.name, col.cx, SIGNATURE_STYLE.y, (SIGNATURE_STYLE.cap / CAP.script) * SCALE, width);

    const rank = drawable(fonts.bold, person.title || '');
    if (!rank) return;
    const big = (RANK_STYLE.cap / CAP.bold) * SCALE;
    if (fonts.bold.widthOfTextAtSize(rank, big) <= X(width)) {
      centered(fonts.bold, rank, col.cx, RANK_STYLE.y, big, width);
    } else {
      // Too long for one line, as in "Executive Director of / HR&SO".
      const small = (RANK_STYLE.small / CAP.bold) * SCALE;
      const lines = wrapLines(fonts.bold, small, rank.split(' '), X(width), X(width)).slice(0, 2);
      lines.forEach((line, k) => centered(fonts.bold, line, col.cx, RANK_STYLE.twoLineY[k], small, width));
    }
  });

  return Buffer.from(await pdf.save());
}

// A file name that is safe on every system and still says who it is for.
function letterFileName(name, ms = Date.now()) {
  const safe = String(name || 'staff').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'staff';
  return `NorthGate-Termination-${safe}-${new Date(ms).toISOString().slice(0, 10)}.pdf`;
}

function hasTemplate() {
  return fs.existsSync(templatePath());
}

module.exports = { terminationLetter, letterFileName, hasTemplate, longDate, shortDate, templatePath };
