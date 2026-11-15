// GET /api/catalog?ra=&dec=&r=  ->  Gaia DR3 stars in a cone (positions at epoch 2016.0), brightest first.
// AI-assisted: written with Claude Code (Anthropic).
import { gaiaCone } from '../src/gaia.js';
import { api, num, query, sendJson } from '../src/http.js';

export default api(async (req, res) => {
  const q = query(req);
  const ra = num(q, 'ra', 0, 359.999999), dec = num(q, 'dec', -90, 90), r = num(q, 'r', 0.005, 0.25);
  const { source, stars } = await gaiaCone(ra, dec, r);
  sendJson(res, 200, { epoch: 2016.0, source, stars }, 86400);
});
