// Binary reply format shared by /api/frames and the snapshot files:
// "SDF1" + uint32 LE (JSON length, padded to a multiple of 4) + JSON + one Float32 (little-endian) n*n block per ok frame.
// AI-assisted: written with Claude Code (Anthropic).
export const MAX_PATHS = 8;

/** results: [{ ok, meta, data } | { ok: false, reason }], paths: the image path of each result; extra: more JSON fields. */
export function packFrames(n, results, paths, extra = {}) {
  const frames = results.map((r, i) => (r.ok ? { p: paths[i], ok: true, ...r.meta } : { p: paths[i], ok: false, reason: r.reason }));
  let json = JSON.stringify({ n, ...extra, frames });
  json += ' '.repeat((4 - (Buffer.byteLength(json) % 4)) % 4);
  const jbuf = Buffer.from(json, 'utf8');
  const head = Buffer.alloc(8);
  head.write('SDF1', 0, 'latin1');
  head.writeUInt32LE(jbuf.length, 4);
  const bufs = [head, jbuf];
  for (const r of results) if (r.ok) bufs.push(Buffer.from(r.data.buffer, r.data.byteOffset, r.data.byteLength));
  return Buffer.concat(bufs);
}
