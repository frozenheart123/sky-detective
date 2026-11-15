// Gaia DR3 stars in a cone. Asks the ESA Gaia Archive first; NASA/IPAC IRSA's copy is the fallback.
// AI-assisted: written with Claude Code (Anthropic).
import { parseCsv, tap } from './irsa.js';

const COLS = 'source_id, ra, dec, pmra, pmdec, parallax, phot_g_mean_mag';
const cone = (table, ra, dec, r) => `SELECT TOP 600 ${COLS} FROM ${table} WHERE 1 = CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', ${ra}, ${dec}, ${r})) ` +
  'AND phot_g_mean_mag < 19.5 ORDER BY phot_g_mean_mag';
const f = (v) => (v === undefined || v === '' || v === 'null' ? null : Number(v));

async function fromEsa(ra, dec, r) {
  const url = 'https://gea.esac.esa.int/tap-server/tap/sync?REQUEST=doQuery&LANG=ADQL&FORMAT=csv&QUERY=' + encodeURIComponent(cone('gaiadr3.gaia_source', ra, dec, r));
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const text = await res.text();
  if (!res.ok || !text.startsWith('source_id')) throw new Error('ESA Gaia Archive error ' + res.status);
  return parseCsv(text);
}

/** { source, stars: [{ id, ra, dec, pmra, pmdec, plx, g }] }, brightest first; positions at epoch 2016.0. */
export async function gaiaCone(ra, dec, r) {
  let rows, source = 'Gaia DR3, ESA Gaia Archive';
  try {
    rows = await fromEsa(ra, dec, r);
  } catch {
    rows = await tap(cone('gaia_dr3_source', ra, dec, r), 25000);
    source = 'Gaia DR3 (ESA), served by NASA/IPAC IRSA';
  }
  const stars = rows
    .map((s) => ({ id: s.source_id, ra: f(s.ra), dec: f(s.dec), pmra: f(s.pmra), pmdec: f(s.pmdec), plx: f(s.parallax), g: f(s.phot_g_mean_mag) }))
    .filter((s) => Number.isFinite(s.ra) && Number.isFinite(s.dec) && Number.isFinite(s.g));
  return { source, stars };
}
