// GET /api/search?ra=&dec=  ->  every SPHEREx spectral image covering that position.
// AI-assisted: written with Claude Code (Anthropic).
import { api, num, query, sendJson } from '../src/http.js';
import { searchImages } from '../src/spherex.js';

export default api(async (req, res) => {
  const q = query(req);
  const ra = num(q, 'ra', 0, 359.999999), dec = num(q, 'dec', -90, 90);
  const t0 = Date.now();
  const images = await searchImages(ra, dec);
  // Never cache an empty answer: it may only mean the archive was having a bad moment.
  sendJson(res, 200, { ra, dec, took: Date.now() - t0, images: images.map((i) => [i.p, i.mjd, i.det]) }, images.length ? 3600 : 0);
});
