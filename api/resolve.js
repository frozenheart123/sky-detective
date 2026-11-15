// GET /api/resolve?name=  ->  sky position of a named object, from the CDS Sesame name resolver (SIMBAD/NED/VizieR).
// AI-assisted: written with Claude Code (Anthropic).
import { api, BadRequest, query, sendJson } from '../src/http.js';

const MIRRORS = [
  'https://vizier.cfa.harvard.edu/viz-bin/nph-sesame/-oI/SNV?',
  'https://cds.unistra.fr/cgi-bin/nph-sesame/-oI/SNV?',
];

export function parseSesame(text) {
  const j = /^%J\s+([\d.]+)\s+([+-]?[\d.]+)/m.exec(text);
  if (!j) return null;
  const p = /^%P\s+([+-]?[\d.]+)\s+([+-]?[\d.]+)/m.exec(text);
  return { ra: Number(j[1]), dec: Number(j[2]), pmra: p ? Number(p[1]) : null, pmdec: p ? Number(p[2]) : null };
}

export default api(async (req, res) => {
  const name = (query(req).get('name') || '').trim();
  if (!name || name.length > 80 || !/^[\p{L}\p{N}\s+\-.'*()[\]]+$/u.test(name)) throw new BadRequest('"name" must be an object name of up to 80 characters');
  let reached = false;
  for (const base of MIRRORS) {
    try {
      const r = await fetch(base + encodeURIComponent(name), { signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      reached = true;
      const hit = parseSesame(await r.text());
      if (hit) return sendJson(res, 200, { name, ...hit }, 86400);
    } catch { /* try the next mirror */ }
  }
  sendJson(res, reached ? 404 : 502, { error: reached ? 'No object with that name was found.' : 'The name service could not be reached. Type coordinates instead.' });
});
