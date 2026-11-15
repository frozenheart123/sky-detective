"""Does IRSA support multi-range HTTP requests (multipart/byteranges)?

AI-assisted: written with Claude Code (Anthropic, Claude Opus 5.5).
"""
import time

import requests

url = ("https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/level2/2025W33_2C/"
       "l2b-v27-2026-228/6/level2_2025W33_2C_0321_1D6_spx_l2b-v27-2026-228.fits")
ranges = ",".join(f"{100000 + i * 8160}-{100000 + i * 8160 + 319}" for i in range(80))
t0 = time.time()
r = requests.get(url, headers={"Range": f"bytes={ranges}"}, timeout=90)
print("status", r.status_code, "type", r.headers.get("Content-Type"), "bytes", len(r.content), f"{time.time() - t0:.1f}s")
