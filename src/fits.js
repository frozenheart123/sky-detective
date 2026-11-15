// Minimal FITS reading: headers and one binary-table row. No dependencies.
// AI-assisted: written with Claude Code (Anthropic).
export const BLOCK = 2880;
export const padded = (n) => Math.ceil(n / BLOCK) * BLOCK;

function parseValue(text) {
  const s = text.trimStart();
  if (s[0] === "'") {
    let out = '';
    for (let i = 1; i < s.length; i++) {
      if (s[i] === "'") {
        if (s[i + 1] === "'") { out += "'"; i++; continue; }
        break;
      }
      out += s[i];
    }
    return out.trimEnd();
  }
  const tok = s.split('/')[0].trim();
  if (tok === 'T') return true;
  if (tok === 'F') return false;
  if (tok === '') return null;
  const n = Number(tok.replace(/^([-+]?[\d.]+)D([-+]?\d+)$/i, '$1E$2'));
  return Number.isNaN(n) ? tok : n;
}

/**
 * Parse one FITS header starting at buf[offset].
 * Returns { h, next } (keyword map and the offset just after the padded header),
 * or null when the END card is not inside buf.
 */
export function parseHeader(buf, offset = 0) {
  const h = {};
  for (let i = offset; i + 80 <= buf.length; i += 80) {
    const card = buf.toString('latin1', i, i + 80);
    const key = card.slice(0, 8).trimEnd();
    if (key === 'END') return { h, next: offset + padded(i + 80 - offset) };
    if (key === 'HIERARCH') {
      const eq = card.indexOf('=');
      if (eq > 9) h[card.slice(9, eq).trim()] = parseValue(card.slice(eq + 1));
    } else if (card[8] === '=') {
      h[key] = parseValue(card.slice(9));
    }
  }
  return null;
}

/** Size in bytes of an HDU's data area (before padding). */
export function dataSize(h) {
  const naxis = h.NAXIS || 0;
  if (!naxis) return 0;
  let n = Math.abs(h.BITPIX) / 8;
  for (let i = 1; i <= naxis; i++) n *= h['NAXIS' + i];
  return n + (h.PCOUNT || 0);
}

const READERS = {
  B: [1, (b, o) => b.readUInt8(o)],
  I: [2, (b, o) => b.readInt16BE(o)],
  J: [4, (b, o) => b.readInt32BE(o)],
  K: [8, (b, o) => Number(b.readBigInt64BE(o))],
  E: [4, (b, o) => b.readFloatBE(o)],
  D: [8, (b, o) => b.readDoubleBE(o)],
};

/** Read the first row of a binary table: { columnName: [values] }. */
export function readTableRow(h, data) {
  const out = {};
  let off = 0;
  for (let c = 1; c <= h.TFIELDS; c++) {
    const m = /^(\d*)([A-Z])/.exec(String(h['TFORM' + c]).trim());
    if (!m || !READERS[m[2]]) throw new Error('Unsupported table column format ' + h['TFORM' + c]);
    const rep = m[1] === '' ? 1 : Number(m[1]);
    const [size, read] = READERS[m[2]];
    const col = new Array(rep);
    for (let k = 0; k < rep; k++) col[k] = read(data, off + k * size);
    out[String(h['TTYPE' + c]).trim()] = col;
    off += rep * size;
  }
  return out;
}
