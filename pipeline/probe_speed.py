"""Measure cutout download speed (gzip vs plain, parallel).

AI-assisted: written with Claude Code (Anthropic, Claude Opus 5.5).
"""
import concurrent.futures as cf
import time

import requests
from astroquery.ipac.irsa import Irsa

ra, dec = 269.44627, 4.76820
q = f"""
SELECT 'https://irsa.ipac.caltech.edu/' || a.uri AS uri, p.time_bounds_lower AS t, p.energy_bandpassname AS band
FROM spherex.artifact a JOIN spherex.plane p ON a.planeid = p.planeid
WHERE 1 = CONTAINS(POINT('ICRS', {ra}, {dec}), p.poly)
ORDER BY p.time_bounds_lower
"""
res = Irsa.query_tap(q).to_table()
mjd = [float(x) for x in res['t']]
gaps = [(round(mjd[i]), round(mjd[i + 1] - mjd[i])) for i in range(len(mjd) - 1) if mjd[i + 1] - mjd[i] > 20]
print("big gaps (mjd, days):", gaps)
uris = list(res['uri'])


def get(url):
    t0 = time.time()
    r = requests.get(url, timeout=180)
    return len(r.content), r.headers.get('Content-Type'), r.headers.get('Content-Encoding'), time.time() - t0


for gz in ("true", "false"):
    u = uris[10] + f"?center={ra},{dec}d&size=0.12&gzip={gz}"
    print("gzip", gz, get(u))

batch = [u + f"?center={ra},{dec}d&size=0.12" for u in uris[20:36]]
t0 = time.time()
with cf.ThreadPoolExecutor(max_workers=8) as ex:
    out = list(ex.map(get, batch))
print(f"16 cutouts with 8 workers: {time.time() - t0:.1f}s; per-file times:", [round(o[3], 1) for o in out])
