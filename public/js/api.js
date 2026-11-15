// Browser-side calls to this site's own /api endpoints (which read from NASA/IPAC IRSA).
// AI-assisted: written with Claude Code (Anthropic).
export const BATCH = 6;

async function getJson(url, signal) {
  const r = await fetch(url, { signal });
  let body = null;
  try { body = await r.json(); } catch { /* not JSON */ }
  if (!r.ok) throw new Error((body && body.error) || 'Request failed (' + r.status + ')');
  return body;
}
const qs = (o) => Object.entries(o).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');

/** Parse the "SDF1" binary format (see src/pack.js): { head, frames: [{ meta, data: Float32Array | null }] }. */
export function parseFrames(buf) {
  const dv = new DataView(buf);
  const magic = buf.byteLength >= 8 ? String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) : '';
  if (magic !== 'SDF1') throw new Error('Unreadable reply from the server');
  const jlen = dv.getUint32(4, true);
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, jlen)));
  const bytes = head.n * head.n * 4;
  let off = 8 + jlen;
  const frames = head.frames.map((meta) => {
    if (!meta.ok) return { meta, data: null };
    const data = new Float32Array(buf.slice(off, off + bytes));
    off += bytes;
    return { meta, data };
  });
  return { head, frames };
}

/** Every SPHEREx image covering (ra, dec): [{ p, mjd, det }], oldest first. */
export async function search(ra, dec, signal) {
  const j = await getJson('api/search?' + qs({ ra, dec }), signal);
  return j.images.map(([p, mjd, det]) => ({ p, mjd, det }));
}

/** Read up to BATCH images, resampled onto `grid`. */
export async function frames(grid, paths, signal) {
  const r = await fetch('api/frames?' + qs({ ra: grid.ra, dec: grid.dec, n: grid.n, scale: grid.scale }) + '&p=' + paths.join(','), { signal });
  if (!r.ok) {
    let msg = 'Request failed (' + r.status + ')';
    try { msg = (await r.json()).error || msg; } catch { /* keep the status text */ }
    throw new Error(msg);
  }
  return parseFrames(await r.arrayBuffer()).frames;
}

export const catalog = (ra, dec, r, signal) => getJson('api/catalog?' + qs({ ra, dec, r: r.toFixed(4) }), signal);
export const resolve = (name, signal) => getJson('api/resolve?' + qs({ name }), signal);

/** A saved copy of a preset target (made by scripts/make-snapshots.js), or null when there is none. */
export async function snapshot(id, signal) {
  try {
    const r = await fetch('snap/' + id + '.bin', { signal });
    if (!r.ok || !(r.headers.get('content-type') || '').includes('octet-stream')) return null;
    return parseFrames(await r.arrayBuffer());
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    return null;
  }
}
