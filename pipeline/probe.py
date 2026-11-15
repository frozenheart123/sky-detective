"""Probe SPHEREx data access for the five challenge targets.

AI-assisted: written with Claude Code (Anthropic, Claude Opus 5.5).
"""
import io
import sys
import time

import requests
from astropy.io import fits
from astroquery.ipac.irsa import Irsa

try:
    tabs = Irsa.query_tap("SELECT table_name FROM TAP_SCHEMA.tables WHERE table_name LIKE '%gaia%'").to_table()
    print("IRSA gaia tables:", list(tabs['table_name']))
except Exception as e:  # noqa: BLE001
    print("gaia table list error:", e)

ra, dec = 269.44627, 4.76820  # Barnard's Star propagated to 2026.0
q = f"""
SELECT 'https://irsa.ipac.caltech.edu/' || a.uri AS uri, p.time_bounds_lower AS t, p.energy_bandpassname AS band
FROM spherex.artifact a JOIN spherex.plane p ON a.planeid = p.planeid
WHERE 1 = CONTAINS(POINT('ICRS', {ra}, {dec}), p.poly)
ORDER BY p.time_bounds_lower
"""
t0 = time.time()
res = Irsa.query_tap(q).to_table()
print(f"TAP rows={len(res)} in {time.time() - t0:.1f}s")
print("bands:", {b: int((res['band'] == b).sum()) for b in sorted(set(res['band']))})
print("time range (MJD):", float(res['t'].min()), float(res['t'].max()))
print("first uris:", list(res['uri'][:3]))

url = res['uri'][0] + f"?center={ra},{dec}d&size=0.12"
t0 = time.time()
resp = requests.get(url, timeout=120)
print(f"cutout bytes={len(resp.content)} status={resp.status_code} in {time.time() - t0:.1f}s")
with fits.open(io.BytesIO(resp.content)) as h:
    h.info()
sys.stdout.flush()
