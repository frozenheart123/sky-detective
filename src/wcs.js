// FITS world coordinates for SPHEREx images: TAN projection with SIP distortion.
// Pixel coordinates here are 0-based (first pixel centre = 0), like numpy/astropy origin 0.
// AI-assisted: written with Claude Code (Anthropic).
import { tanDeproject, tanProject } from '../public/js/sky.js';

function sipTerms(h, name) {
  const order = h[name + '_ORDER'];
  const terms = [];
  if (!order) return terms;
  for (let p = 0; p <= order; p++) {
    for (let q = 0; p + q <= order; q++) {
      const c = h[`${name}_${p}_${q}`];
      if (c) terms.push([p, q, c]);
    }
  }
  return terms;
}

function evalPoly(terms, u, v) {
  let s = 0;
  for (let k = 0; k < terms.length; k++) {
    const t = terms[k];
    s += t[2] * u ** t[0] * v ** t[1];
  }
  return s;
}

export class Wcs {
  constructor(h) {
    if (!String(h.CTYPE1).startsWith('RA---TAN') || !String(h.CTYPE2).startsWith('DEC--TAN')) {
      throw new Error('Unsupported projection ' + h.CTYPE1 + ' / ' + h.CTYPE2);
    }
    if (h.LONPOLE !== undefined && Math.abs(h.LONPOLE - 180) > 1e-9) throw new Error('Unsupported LONPOLE ' + h.LONPOLE);
    this.crpix1 = h.CRPIX1;
    this.crpix2 = h.CRPIX2;
    this.ra0 = h.CRVAL1;
    this.dec0 = h.CRVAL2;
    const c1 = h.CDELT1 ?? 1, c2 = h.CDELT2 ?? 1;
    const cd = h.CD1_1 !== undefined
      ? [h.CD1_1, h.CD1_2 ?? 0, h.CD2_1 ?? 0, h.CD2_2]
      : [c1 * (h.PC1_1 ?? 1), c1 * (h.PC1_2 ?? 0), c2 * (h.PC2_1 ?? 0), c2 * (h.PC2_2 ?? 1)];
    const det = cd[0] * cd[3] - cd[1] * cd[2];
    if (!Number.isFinite(det) || det === 0) throw new Error('Bad WCS matrix');
    this.cd = cd;
    this.inv = [cd[3] / det, -cd[1] / det, -cd[2] / det, cd[0] / det];
    this.A = sipTerms(h, 'A');
    this.B = sipTerms(h, 'B');
  }

  /** 0-based pixel -> [ra, dec] in degrees. */
  pix2world(x, y) {
    const u = x + 1 - this.crpix1, v = y + 1 - this.crpix2;
    const f = u + evalPoly(this.A, u, v), g = v + evalPoly(this.B, u, v);
    return tanDeproject(this.cd[0] * f + this.cd[1] * g, this.cd[2] * f + this.cd[3] * g, this.ra0, this.dec0);
  }

  /** [ra, dec] in degrees -> 0-based pixel. The SIP distortion is inverted by fixed-point iteration. */
  world2pix(ra, dec) {
    const [xi, eta] = tanProject(ra, dec, this.ra0, this.dec0);
    const U = this.inv[0] * xi + this.inv[1] * eta, V = this.inv[2] * xi + this.inv[3] * eta;
    let u = U, v = V;
    for (let it = 0; it < 6; it++) {
      const nu = U - evalPoly(this.A, u, v), nv = V - evalPoly(this.B, u, v);
      u = nu;
      v = nv;
    }
    return [u + this.crpix1 - 1, v + this.crpix2 - 1];
  }
}
