"""Check the WCS-WAVE reader: wavelength at the image centre should fall inside each detector's band.

AI-assisted: written with Claude Code (Anthropic, Claude Opus 5.5).
"""
import astropy.units as u
from astropy.coordinates import SkyCoord

from spherex_io import find_images, read_patch, wavelength_at

c = SkyCoord(76.956417 * u.deg, 30.401417 * u.deg)  # RW Aur
rows = find_images(c.ra.deg, c.dec.deg)
seen = set()
for r in rows:
    det = int(str(r["band"])[-1])
    if det in seen:
        continue
    res = read_patch(str(r["uri"]), c, 8)
    if res is None:
        continue
    _, w, x0, y0, h1 = res
    x, y = (float(v) for v in w.world_to_pixel(c))
    print(f"D{det}: pixel ({x:.0f},{y:.0f}) -> {wavelength_at(str(r['uri']), det, h1, x, y):.3f} um")
    seen.add(det)
    if len(seen) == 6:
        break
