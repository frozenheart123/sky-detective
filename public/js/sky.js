// Sky coordinate maths shared by the browser and the Node backend. No DOM, no dependencies.
// AI-assisted: written with Claude Code (Anthropic).
export const D2R = Math.PI / 180;

/** Gnomonic (TAN) projection: sky (deg) -> tangent-plane offsets (deg) about (ra0, dec0). */
export function tanProject(ra, dec, ra0, dec0) {
  const d = dec * D2R, d0 = dec0 * D2R, da = (ra - ra0) * D2R;
  const cosc = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(da);
  const xi = Math.cos(d) * Math.sin(da) / cosc;
  const eta = (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(da)) / cosc;
  return [xi / D2R, eta / D2R];
}

/** Inverse of tanProject: tangent-plane offsets (deg) -> sky (deg). */
export function tanDeproject(xiDeg, etaDeg, ra0, dec0) {
  const xi = xiDeg * D2R, eta = etaDeg * D2R, d0 = dec0 * D2R;
  const den = Math.cos(d0) - eta * Math.sin(d0);
  let ra = ra0 + Math.atan2(xi, den) / D2R;
  const dec = Math.atan2(Math.sin(d0) + eta * Math.cos(d0), Math.hypot(xi, den)) / D2R;
  ra = ((ra % 360) + 360) % 360;
  return [ra, dec];
}

// The display grid: n x n pixels of `scale` arcsec, centred on (ra, dec), north up, east left.
// Pixel (i, j): i grows to the right (west), j grows downward (south); (0, 0) is the top-left pixel centre.
export function gridToSky(i, j, g) {
  const h = (g.n - 1) / 2;
  return tanDeproject((h - i) * g.scale / 3600, (h - j) * g.scale / 3600, g.ra, g.dec);
}
export function skyToGrid(ra, dec, g) {
  const [xi, eta] = tanProject(ra, dec, g.ra, g.dec);
  const h = (g.n - 1) / 2;
  return [h - xi * 3600 / g.scale, h - eta * 3600 / g.scale];
}

/** Move a position by its proper motion (mas/yr) over `years`. */
export function propagate(ra, dec, pmra, pmdec, years) {
  const d = dec + (pmdec || 0) / 3.6e6 * years;
  const r = ra + (pmra || 0) / 3.6e6 * years / Math.cos(dec * D2R);
  return [((r % 360) + 360) % 360, d];
}

export const mjdToYear = (mjd) => 2000 + (mjd - 51544.5) / 365.25;
export const mjdToDate = (mjd) => new Date((mjd - 40587) * 86400000);

/** Parse "269.45 4.69", "17h57m48.5s +04d41m36s", "17:57:48.5 +04:41:36" or "17 57 48.5 +04 41 36". */
export function parseCoords(text) {
  const s = String(text).trim().replace(/[−–]/g, '-');
  const dm = /^([+-]?\d+(?:\.\d+)?)\s*[°d]?[\s,]+([+-]?\d+(?:\.\d+)?)\s*[°d]?$/i.exec(s);
  let c = null;
  if (dm) c = { ra: Number(dm[1]), dec: Number(dm[2]) };
  else {
    const m = /^(\d{1,2})[h:\s]+(\d{1,2})[m:\s]+(\d{1,2}(?:\.\d+)?)s?[\s,]+([+-]?)(\d{1,2})[d°:\s]+(\d{1,2})['′m:\s]+(\d{1,2}(?:\.\d+)?)["″s]?$/i.exec(s);
    if (m) {
      const sign = m[4] === '-' ? -1 : 1;
      c = { ra: (Number(m[1]) + m[2] / 60 + m[3] / 3600) * 15, dec: sign * (Number(m[5]) + m[6] / 60 + m[7] / 3600) };
    }
  }
  if (!c || !(c.ra >= 0 && c.ra < 360 && c.dec >= -90 && c.dec <= 90)) return null;
  return c;
}

const p2 = (x) => String(x).padStart(2, '0');
export function fmtRa(deg) {
  const v = (((deg % 360) + 360) % 360) / 15, h = Math.floor(v), m = Math.floor((v - h) * 60);
  const s = ((v - h) * 60 - m) * 60;
  return p2(h) + 'h ' + p2(m) + 'm ' + s.toFixed(1).padStart(4, '0') + 's';
}
export function fmtDec(deg) {
  const v = Math.abs(deg), d = Math.floor(v), m = Math.floor((v - d) * 60);
  const s = Math.round(((v - d) * 60 - m) * 60);
  return (deg < 0 ? '−' : '+') + p2(d) + '° ' + p2(m) + '′ ' + p2(Math.min(59, s)) + '″';
}

/** Angular separation in arcsec (small-angle safe). */
export function sepArcsec(ra1, dec1, ra2, dec2) {
  const [xi, eta] = tanProject(ra2, dec2, ra1, dec1);
  return Math.hypot(xi, eta) * 3600;
}
