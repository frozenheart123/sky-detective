"""Time the range-request reader on Barnard's Star.

AI-assisted: written with Claude Code (Anthropic, Claude Opus 5.5).
"""
import concurrent.futures as cf
import time

import astropy.units as u
from astropy.coordinates import SkyCoord

from spherex_io import find_images, read_patch

c = SkyCoord(269.44627 * u.deg, 4.76820 * u.deg)
res = find_images(c.ra.deg, c.dec.deg)
print("rows", len(res), "cols", res.colnames)
uris = list(res["uri"])

t0 = time.time()
p = read_patch(uris[5], c)
print("single:", None if p is None else p[0].shape, f"{time.time() - t0:.1f}s")


def job(u_):
    t = time.time()
    r = read_patch(u_, c)
    return (None if r is None else r[0].shape), round(time.time() - t, 1)


t0 = time.time()
with cf.ThreadPoolExecutor(max_workers=8) as ex:
    out = list(ex.map(job, uris[40:72]))
print(f"32 patches with 8 workers: {time.time() - t0:.1f}s", out)
