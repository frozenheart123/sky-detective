// Talking to NASA/IPAC IRSA: byte-range reads of SPHEREx image files, image search (SIA) and TAP (ADQL) queries.
// Only IRSA is ever contacted, and only for SPHEREx Level-2 image paths that pass isDataPath().
// AI-assisted: written with Claude Code (Anthropic).
const HOST = 'https://irsa.ipac.caltech.edu/';
const DATA = 'ibe/data/spherex/';
const PATH_RE = /^(?:dr|qr)\d+(?:_deep)?\/level2\/[A-Za-z0-9_\-/.]+\.fits$/;
const MAX_RANGES = 96; // IRSA honours at most 100 ranges per request; with more it sends the whole file

export const isDataPath = (p) => typeof p === 'string' && p.length < 240 && PATH_RE.test(p) && !p.includes('..');
export const dataUrl = (p) => HOST + DATA + p;
/** "ibe/data/spherex/<path>" or the full IRSA URL of it -> <path>; anything else -> null. */
export function dataPath(uri) {
  const rel = uri.startsWith(HOST) ? uri.slice(HOST.length) : uri;
  return rel.startsWith(DATA) ? rel.slice(DATA.length) : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function retry(fn, tries = 3) {
  let last;
  for (let a = 0; a < tries; a++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (e && e.fatal) break;
      await sleep(350 * (a + 1));
    }
  }
  throw last;
}

async function rangeRequest(url, spec) {
  const r = await fetch(url, { headers: { Range: 'bytes=' + spec }, signal: AbortSignal.timeout(30000) });
  if (r.status !== 206) {
    if (r.body) await r.body.cancel().catch(() => {}); // never download a whole 70 MB image by accident
    if (r.status === 404 || r.status === 403) throw Object.assign(new Error('IRSA has no such file (HTTP ' + r.status + ')'), { fatal: true });
    throw new Error('IRSA answered HTTP ' + r.status);
  }
  return { type: r.headers.get('content-type') || '', range: r.headers.get('content-range') || '', body: Buffer.from(await r.arrayBuffer()) };
}

/** Bytes [start, stop) of a file. */
export async function getRange(url, start, stop) {
  return retry(async () => (await rangeRequest(url, `${start}-${stop - 1}`)).body);
}

function splitParts(res) {
  const m = /boundary=("?)([^";]+)\1/i.exec(res.type);
  if (!m) {
    const cr = /bytes (\d+)-(\d+)/.exec(res.range);
    if (!cr) throw new Error('IRSA sent an unreadable range reply');
    return [{ start: Number(cr[1]), data: res.body }];
  }
  const delim = Buffer.from('--' + m[2]);
  const parts = [];
  let pos = res.body.indexOf(delim);
  while (pos >= 0) {
    const headEnd = res.body.indexOf('\r\n\r\n', pos);
    if (headEnd < 0) break;
    const cr = /content-range:\s*bytes (\d+)-(\d+)/i.exec(res.body.toString('latin1', pos, headEnd));
    if (!cr) break;
    const start = Number(cr[1]), len = Number(cr[2]) - start + 1, d0 = headEnd + 4;
    parts.push({ start, data: res.body.subarray(d0, d0 + len) });
    pos = res.body.indexOf(delim, d0 + len);
  }
  return parts;
}

/** Several byte ranges [[start, stop), ...] in as few requests as possible. Returns Buffers in the same order. */
export async function getRanges(url, ranges) {
  const out = new Array(ranges.length);
  for (let c = 0; c < ranges.length; c += MAX_RANGES) {
    const chunk = ranges.slice(c, c + MAX_RANGES);
    await retry(async () => {
      const parts = splitParts(await rangeRequest(url, chunk.map(([a, b]) => `${a}-${b - 1}`).join(',')));
      chunk.forEach(([a, b], k) => {
        const part = parts.find((p) => p.start <= a && b <= p.start + p.data.length);
        if (!part) throw new Error('IRSA left out a byte range');
        out[c + k] = part.data.subarray(a - part.start, b - part.start);
      });
    });
  }
  return out;
}

/** CSV text (quoted fields allowed) -> rows as objects of strings, keyed by the header line. */
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  if (!rows.length) return [];
  const names = rows[0];
  return rows.slice(1).filter((r) => r.length === names.length).map((r) => Object.fromEntries(names.map((n, i) => [n, r[i]])));
}

/** IRSA Simple Image Access: the images of one collection that touch (ra, dec). */
export async function sia(collection, ra, dec, timeoutMs = 25000) {
  const r = await fetch(`${HOST}SIA?COLLECTION=${collection}&POS=circle+${ra}+${dec}+0.0003&RESPONSEFORMAT=CSV`, { signal: AbortSignal.timeout(timeoutMs) });
  const text = await r.text();
  if (!r.ok || text.trimStart().startsWith('<')) throw new Error('The IRSA image search failed (HTTP ' + r.status + ')');
  return siaRows(text);
}

/**
 * IRSA's SIA "CSV" is not strict CSV: a late column (cloud_access) holds unquoted JSON with commas.
 * The three columns we need come before it, so read them by position from a plain comma split.
 */
export function siaRows(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length);
  if (!lines.length) return [];
  const head = lines[0].split(',');
  const iu = head.indexOf('access_url'), it = head.indexOf('t_min'), ib = head.indexOf('energy_bandpassname');
  if (iu < 0 || it < 0 || ib < 0) throw new Error('The IRSA image search sent unexpected columns');
  return lines.slice(1).map((line) => {
    const c = line.split(',');
    return { access_url: c[iu] || '', t_min: c[it], energy_bandpassname: c[ib] || '' };
  });
}

/** Run an ADQL query on IRSA's TAP service; returns rows as objects of strings. */
export async function tap(adql, timeoutMs = 30000) {
  const r = await fetch(HOST + 'TAP/sync?FORMAT=CSV&QUERY=' + encodeURIComponent(adql), { signal: AbortSignal.timeout(timeoutMs) });
  const text = await r.text();
  if (!r.ok || text.trimStart().startsWith('<')) throw new Error('The IRSA archive search failed (HTTP ' + r.status + ')');
  return parseCsv(text);
}
