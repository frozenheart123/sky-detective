// GET /api/frames?ra=&dec=&n=&scale=&p=path1,path2,...
// Reads each image from IRSA and returns it resampled onto the requested north-up grid (format: src/pack.js).
// AI-assisted: written with Claude Code (Anthropic).
import { api, BadRequest, num, query } from '../src/http.js';
import { isDataPath } from '../src/irsa.js';
import { MAX_PATHS, packFrames } from '../src/pack.js';
import { readFrame } from '../src/spherex.js';

export default api(async (req, res) => {
  const q = query(req);
  const grid = { ra: num(q, 'ra', 0, 359.999999), dec: num(q, 'dec', -90, 90), n: Math.round(num(q, 'n', 16, 128)), scale: num(q, 'scale', 3, 20) };
  const paths = (q.get('p') || '').split(',').filter(Boolean);
  if (!paths.length || paths.length > MAX_PATHS) throw new BadRequest(`"p" needs 1 to ${MAX_PATHS} image paths`);
  if (!paths.every(isDataPath)) throw new BadRequest('"p" has a path that is not a SPHEREx Level-2 image');
  const results = await Promise.all(paths.map((p) => readFrame(p, grid).catch((e) => ({ ok: false, reason: String((e && e.message) || e) }))));
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/octet-stream');
  // A released image never changes, so a fully successful batch can be cached for a long time.
  res.setHeader('Cache-Control', results.every((r) => r.ok) ? 'public, max-age=86400, s-maxage=2592000' : 'no-store');
  res.end(packFrames(grid.n, results, paths));
});
