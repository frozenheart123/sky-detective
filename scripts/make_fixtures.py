"""Create test fixtures for the Node backend from one real SPHEREx image, with astropy as the reference.

Writes tests/fixtures/spherex-d6.json: the raw FITS header bytes, astropy's pixel<->sky values,
the WCS-WAVE table and astropy's wavelengths, and a small patch with the frame astropy/scipy
resample from it. Usage: .venv/Scripts/python scripts/make_fixtures.py

AI-assisted: written with Claude Code (Anthropic).
"""
import base64
import json
import sys
import warnings
from pathlib import Path

import astropy.units as u
import numpy as np
import requests
from astropy.coordinates import SkyCoord
from astropy.io import fits
from astropy.wcs import WCS
from scipy.ndimage import map_coordinates

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "pipeline"))
from spherex_io import BLOCK, _data_size, _get, _padded, _parse_header, read_patch  # noqa: E402

warnings.filterwarnings("ignore")
HOST = "https://irsa.ipac.caltech.edu/"
PATH = "dr1/level2/2025W33_2C/l2b-v27-2026-228/6/level2_2025W33_2C_0321_1D6_spx_l2b-v27-2026-228.fits"
URL = HOST + "ibe/data/spherex/" + PATH
RA, DEC, N, SCALE = 269.44627, 4.76820, 48, 6.15


def find_hdu(url, name, start):
    """Walk the HDUs from byte `start`; return (offset, header, header_bytes, data_bytes) of `name`."""
    off = start
    for _ in range(10):
        buf = _get(url, off, off + 60 * BLOCK)
        hdr, rel = _parse_header(buf, 0)
        size = _data_size(hdr)
        if hdr.get("EXTNAME") == name:
            return off, hdr, rel, size
        off += rel + _padded(size)
    raise KeyError(name)


def wave_table(url):
    head = _get(url, 0, 10 * BLOCK)
    h0, off = _parse_header(head, 0)
    h1, data_start = _parse_header(head, off)
    w_off, w_hdr, w_rel, w_size = find_hdu(url, "WCS-WAVE", data_start + _padded(_data_size(h1)))
    raw = _get(url, w_off, w_off + w_rel + w_size)
    hdu = fits.BinTableHDU.fromstring(raw[:w_rel] + raw[w_rel:] + b"\0" * (_padded(w_size) - w_size))
    return head, h1, data_start, raw, w_rel, hdu


head, h1, data_start, wave_raw, wave_rel, wave_hdu = wave_table(URL)
w = WCS(h1)
pts = [(x, y) for x in (0, 300.5, 1019.5, 1500.25, 2039) for y in (0, 420.75, 1019.5, 1777, 2039)]
pix2world = []
for x, y in pts:
    ra, dec = (float(v) for v in w.all_pix2world(x, y, 0))
    bx, by = (float(v) for v in w.all_world2pix(ra, dec, 0, tolerance=1e-8))
    assert abs(bx - x) < 1e-4 and abs(by - y) < 1e-4, (x, y, bx, by)
    pix2world.append([x, y, ra, dec])

tab = wave_hdu.data
hdul = fits.HDUList([fits.PrimaryHDU(), fits.ImageHDU(header=h1), wave_hdu])
sw = WCS(h1, fobj=hdul, key="W")
sw.sip = None
samples = []
for x, y in pts:
    lam, bw = sw.pixel_to_world(x, y)
    samples.append([x, y, float(lam.to_value("um")), float(bw.to_value("um"))])
values = np.asarray(tab["VALUES"][0], dtype=float)
print("X", tab["X"][0].tolist())
print("Y", tab["Y"][0].tolist())
print("VALUES shape", values.shape, "TDIM3", wave_hdu.header.get("TDIM3"))
print("wave samples", [[round(v, 5) for v in s] for s in samples[:6]])

# Is the table the same for another image of the same detector (a later QR3 one)?
q = ("SELECT a.uri FROM spherex.artifact a JOIN spherex.plane p ON a.planeid = p.planeid "
     f"WHERE 1 = CONTAINS(POINT('ICRS', {RA}, {DEC}), p.poly) AND p.energy_bandpassname = 'SPHEREx-D6' "
     "ORDER BY p.time_bounds_lower")
rows = requests.get(HOST + "TAP/sync", params={"QUERY": q, "FORMAT": "CSV"}, timeout=120).text.splitlines()[1:]
for other in (rows[1], rows[-1]):
    _, _, _, _, _, hdu2 = wave_table(HOST + other.strip('"'))
    v2 = np.asarray(hdu2.data["VALUES"][0], dtype=float)
    same_xy = hdu2.data["X"][0].tolist() == tab["X"][0].tolist() and hdu2.data["Y"][0].tolist() == tab["Y"][0].tolist()
    print("same detector, other file:", other.split("/")[4], other.split("/")[6], "X/Y equal:", same_xy,
          "max |dVALUES| (um):", float(np.abs(v2 - values).max()))

# Reference frame: a patch read with astropy's WCS, resampled north-up with scipy (bilinear).
c = SkyCoord(RA * u.deg, DEC * u.deg)
patch, w_in, x0, y0, _ = read_patch(URL, c, 40)   # 80 rows: IRSA ignores Range headers with too many ranges
w_out = WCS(naxis=2)
w_out.wcs.ctype = ["RA---TAN", "DEC--TAN"]
w_out.wcs.crval = [RA, DEC]
w_out.wcs.cdelt = [-SCALE / 3600, SCALE / 3600]
w_out.wcs.crpix = [(N - 1) / 2 + 1, (N - 1) / 2 + 1]
yy, xx = np.mgrid[0:N, 0:N]
px, py = w_in.world_to_pixel(w_out.pixel_to_world(xx, yy))
frame = np.flipud(map_coordinates(patch, [py - y0, px - x0], order=1, mode="constant", cval=np.nan)).astype("<f4")
cx, cy = (float(v) for v in w_in.world_to_pixel(c))


def b64(a):
    return base64.b64encode(a).decode("ascii")


out = dict(
    path=PATH, ra=RA, dec=DEC, n=N, scale=SCALE,
    headB64=b64(head), dataStart=data_start,
    pix2world=pix2world, center=[cx, cy],
    wave=dict(X=tab["X"][0].tolist(), Y=tab["Y"][0].tolist(), VALUES=values.ravel().tolist(), samples=samples,
              rawB64=b64(wave_raw), headerBytes=wave_rel),
    patch=dict(x0=int(x0), y0=int(y0), w=int(patch.shape[1]), h=int(patch.shape[0]), b64=b64(np.ascontiguousarray(patch, dtype="<f4").tobytes())),
    frameB64=b64(frame.tobytes()),
    flags={k: h1[k] for k in h1 if k.startswith("L2 N_")},
)
dest = ROOT / "tests" / "fixtures"
dest.mkdir(parents=True, exist_ok=True)
(dest / "spherex-d6.json").write_text(json.dumps(out), encoding="utf-8")
print("wrote", dest / "spherex-d6.json", "finite frame px", int(np.isfinite(frame).sum()), "of", frame.size)
