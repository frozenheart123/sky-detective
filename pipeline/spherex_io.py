"""Fast partial reads of SPHEREx Level-2 spectral images from IRSA.

The IRSA cutout service also returns the 3.8 MB ePSF table with every cutout,
which makes it slow (about 10 s per cutout). The full image files support HTTP
range requests, so we read just the two FITS headers and the pixel rows we need:
two small requests per image.

AI-assisted: written with Claude Code (Anthropic, Claude Opus 5.5).
"""
from __future__ import annotations

import re
import threading
import time
import warnings

import numpy as np
import requests
from astropy.coordinates import SkyCoord
from astropy.io import fits
from astropy.wcs import WCS, FITSFixedWarning
from astroquery.ipac.irsa import Irsa

warnings.simplefilter("ignore", FITSFixedWarning)
BLOCK = 2880
_local = threading.local()


def _session() -> requests.Session:
    if not hasattr(_local, "s"):
        _local.s = requests.Session()
    return _local.s


def _get(url: str, start: int, stop: int, tries: int = 4) -> bytes:
    """GET bytes [start, stop) with retries."""
    for attempt in range(tries):
        try:
            r = _session().get(url, headers={"Range": f"bytes={start}-{stop - 1}"}, timeout=90)
            if r.status_code == 206:
                return r.content
            raise IOError(f"HTTP {r.status_code}")
        except Exception:  # noqa: BLE001
            if attempt == tries - 1:
                raise
            time.sleep(2 * (attempt + 1))
    raise IOError("unreachable")


def _get_multi(url: str, ranges: list[tuple[int, int]], tries: int = 4) -> list[tuple[int, bytes]]:
    """GET several byte ranges [start, stop) in ONE request (multipart/byteranges)."""
    spec = ",".join(f"{a}-{b - 1}" for a, b in ranges)
    for attempt in range(tries):
        try:
            r = _session().get(url, headers={"Range": f"bytes={spec}"}, timeout=90)
            if r.status_code != 206:
                raise IOError(f"HTTP {r.status_code}")
            ctype = r.headers.get("Content-Type", "")
            if not ctype.startswith("multipart/byteranges"):
                m = re.match(r"bytes (\d+)-(\d+)/", r.headers.get("Content-Range", ""))
                return [(int(m.group(1)), r.content)]
            boundary = ctype.split("boundary=")[1].strip().strip('"').encode()
            parts = []
            for chunk in r.content.split(b"--" + boundary):
                if b"\r\n\r\n" not in chunk:
                    continue
                head, body = chunk.split(b"\r\n\r\n", 1)
                m = re.search(rb"Content-Range:\s*bytes (\d+)-(\d+)/", head, re.I)
                if m:
                    a, b = int(m.group(1)), int(m.group(2))
                    parts.append((a, body[: b - a + 1]))
            return parts
        except Exception:  # noqa: BLE001
            if attempt == tries - 1:
                raise
            time.sleep(2 * (attempt + 1))
    raise IOError("unreachable")


def _parse_header(buf: bytes, offset: int) -> tuple[fits.Header, int]:
    """Parse one FITS header starting at buf[offset]; return it and the offset after it."""
    for i in range(offset, len(buf) - 79, 80):
        if buf[i:i + 8] == b"END     ":
            end = i + 80
            hdr = fits.Header.fromstring(buf[offset:end].decode("ascii"))
            nxt = offset + ((end - offset + BLOCK - 1) // BLOCK) * BLOCK
            return hdr, nxt
    raise ValueError("END card not found; read more header blocks")


def read_patch(url: str, coord: SkyCoord, half: int = 40):
    """Return (patch, full_wcs, x0, y0, header) for a (2*half)^2 pixel patch of the IMAGE extension.

    patch[j, i] is detector pixel (x0 + i, y0 + j), 0-based.

    Pixels that fall off the detector are NaN. Returns None when coord itself is off the detector.
    Two HTTP requests: the headers, then all patch rows as one multi-range request.
    """
    head = _get(url, 0, 12 * BLOCK)
    try:
        h0, off = _parse_header(head, 0)
        h1, data_start = _parse_header(head, off)
    except ValueError:
        head = _get(url, 0, 60 * BLOCK)
        h0, off = _parse_header(head, 0)
        h1, data_start = _parse_header(head, off)
    if h1.get("EXTNAME") != "IMAGE":
        raise ValueError(f"unexpected first extension {h1.get('EXTNAME')}")
    nx, ny = h1["NAXIS1"], h1["NAXIS2"]
    w = WCS(h1)
    x, y = w.world_to_pixel(coord)
    xi, yi = int(round(float(x))), int(round(float(y)))
    if not (0 <= xi < nx and 0 <= yi < ny):
        return None
    x0, x1, y0, y1 = xi - half, xi + half, yi - half, yi + half
    cx0, cx1, cy0, cy1 = max(0, x0), min(nx, x1), max(0, y0), min(ny, y1)
    ranges = [(data_start + (row * nx + cx0) * 4, data_start + (row * nx + cx1) * 4) for row in range(cy0, cy1)]
    parts = _get_multi(url, ranges)
    patch = np.full((2 * half, 2 * half), np.nan, dtype=np.float32)
    for row, (a, b) in zip(range(cy0, cy1), ranges):
        for start, body in parts:
            if start <= a and b <= start + len(body):
                vals = np.frombuffer(body[a - start:b - start], dtype=">f4")
                patch[row - y0, cx0 - x0:cx1 - x0] = vals
                break
    h1["VERSION"] = h0.get("VERSION", "")
    return patch, w, x0, y0, h1


def _padded(n: int) -> int:
    return ((n + BLOCK - 1) // BLOCK) * BLOCK


def _data_size(h: fits.Header) -> int:
    naxis = h.get("NAXIS", 0)
    if naxis == 0:
        return 0
    n = abs(h["BITPIX"]) // 8
    for i in range(1, naxis + 1):
        n *= h[f"NAXIS{i}"]
    return n + h.get("PCOUNT", 0)


def read_hdu(url: str, name: str, max_hdus: int = 10) -> fits.BinTableHDU:
    """Fetch one named table extension (e.g. WCS-WAVE) by walking the FITS headers with range requests."""
    off = 0
    for _ in range(max_hdus):
        buf = _get(url, off, off + 12 * BLOCK)
        try:
            hdr, rel = _parse_header(buf, 0)
        except ValueError:
            buf = _get(url, off, off + 80 * BLOCK)
            hdr, rel = _parse_header(buf, 0)
        start, size = off + rel, _data_size(hdr)
        if hdr.get("EXTNAME") == name:
            data = _get(url, start, start + _padded(size)) if size else b""
            return fits.BinTableHDU.fromstring(hdr.tostring().encode("ascii") + data)
        off = start + _padded(size)
    raise KeyError(f"{name} not found in {url}")


_wave_cache: dict = {}
_wave_lock = threading.Lock()


def wavelength_at(url: str, det: int, image_header: fits.Header, x: float, y: float) -> float:
    """Central wavelength (micron) seen by detector pixel (x, y), from the WCS-WAVE lookup table.

    The table describes the detector's linear variable filter, so it is fetched once per detector
    and data release and reused for every image.
    """
    release = "qr3" if "/qr3/" in url else "dr1"
    key = (det, release)
    with _wave_lock:
        hdu = _wave_cache.get(key)
    if hdu is None:
        hdu = read_hdu(url, "WCS-WAVE")
        with _wave_lock:
            _wave_cache[key] = hdu
    hdul = fits.HDUList([fits.PrimaryHDU(), fits.ImageHDU(header=image_header), hdu])
    w = WCS(image_header, fobj=hdul, key="W")
    w.sip = None
    wl, _bw = w.pixel_to_world(x, y)
    return float(wl.to_value("um"))


def find_images(ra: float, dec: float):
    """All SPHEREx DR1/QR3 spectral images covering (ra, dec), oldest first."""
    q = f"""
    SELECT 'https://irsa.ipac.caltech.edu/' || a.uri AS uri, p.time_bounds_lower AS mjd,
           p.energy_bandpassname AS band
    FROM spherex.artifact a JOIN spherex.plane p ON a.planeid = p.planeid
    WHERE 1 = CONTAINS(POINT('ICRS', {ra}, {dec}), p.poly)
    ORDER BY p.time_bounds_lower
    """
    return Irsa.query_tap(q).to_table()
