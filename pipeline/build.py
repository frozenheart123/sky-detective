"""Build real SPHEREx blink data for the five challenge targets.

For each target:
  1. find every SPHEREx DR1/QR3 spectral image that covers it (IRSA TAP),
  2. read a small patch of each image (HTTP range requests),
  3. resample every patch onto one north-up grid (48 x 48 px, 6.2"/px),
  4. subtract each image's background and median-stack images per sky visit
     ("epoch") and per detector (D1-D6),
  5. find the target in each epoch and measure its brightness,
  6. write web/data/<id>.json for the page.

AI-assisted: written with Claude Code (Anthropic, Claude Opus 5.5).
"""
from __future__ import annotations

import argparse
import base64
import concurrent.futures as cf
import json
import logging
import re
import time
from pathlib import Path

import astropy.units as u
import numpy as np
from astropy.coordinates import SkyCoord
from astropy.stats import mad_std, sigma_clipped_stats
from astropy.time import Time
from astropy.wcs import WCS
from astroquery.ipac.irsa import Irsa
from PIL import Image
from scipy.ndimage import map_coordinates

from spherex_io import find_images, read_patch, wavelength_at

logging.getLogger("astropy").setLevel(logging.ERROR)

N = 48            # output grid size (pixels)
SCALE = 6.2       # arcsec per output pixel (SPHEREx native is about 6.15")
HALF = 40         # half-size of the patch read from each detector image
EPOCH_GAP = 60.0  # days; a longer gap between images starts a new sky visit
EPOCH_MAX_SPAN = 75.0  # days; a visit longer than this (near the ecliptic poles) is split ...
EPOCH_BIN = 45.0       # ... into bins of about this many days
SPEC_R = 2.0           # aperture radius (px) for per-image spectrum points
MJYSR_PX_TO_MJY = (SCALE / 206264.806) ** 2 * 1e9   # MJy/sr summed over 6.2" pixels -> mJy
OUT = Path(__file__).resolve().parent.parent / "web" / "data"
DIAG = Path(__file__).resolve().parent / "diag"

# Positions: (ra, dec) in degrees at `epoch` (decimal year); proper motion in mas/yr.
TARGETS = {
    "barnard": dict(ra=269.452080, dec=4.693364, epoch=2000.0, pmra=-801.55, pmdec=10362.39, best=2),
    # The challenge gives WISE 0855's designation position (WISE epoch, about 2010.5).
    "wise0855": dict(ra=133.795129, dec=-7.245147, epoch=2010.5, pmra=-8118.0, pmdec=680.0, best=6),
    "epsindi": dict(ra=331.043833, dec=-56.782703, epoch=2000.0, pmra=3966.0, pmdec=-2536.0, best=6),
    "rwaur": dict(ra=76.956417, dec=30.401417, epoch=2000.0, pmra=0.0, pmdec=0.0, best=4),
    "rdra": dict(ra=248.167500, dec=66.755000, epoch=2000.0, pmra=0.0, pmdec=0.0, best=3),
}
MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def pos_at(cfg: dict, year: float) -> SkyCoord:
    dt = year - cfg["epoch"]
    dec = cfg["dec"] + cfg["pmdec"] / 1000 * dt / 3600
    ra = cfg["ra"] + cfg["pmra"] / 1000 * dt / 3600 / np.cos(np.radians(cfg["dec"]))
    return SkyCoord(ra * u.deg, dec * u.deg)


def year_of(mjd: float) -> float:
    return Time(mjd, format="mjd").decimalyear


def grid_wcs(center: SkyCoord) -> WCS:
    w = WCS(naxis=2)
    w.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    w.wcs.crval = [center.ra.deg, center.dec.deg]
    w.wcs.cdelt = [-SCALE / 3600, SCALE / 3600]   # east left, north up (FITS y increases north)
    w.wcs.crpix = [N / 2 + 1, N / 2 + 1]           # 0-based pixel (24, 24) = center
    return w


def resample(patch: np.ndarray, w_in: WCS, x0: int, y0: int, w_out: WCS) -> np.ndarray:
    yy, xx = np.mgrid[0:N, 0:N]
    world = w_out.pixel_to_world(xx, yy)
    px, py = w_in.world_to_pixel(world)
    return map_coordinates(patch, [py - y0, px - x0], order=1, mode="constant", cval=np.nan).astype(np.float32)


def obs_key(uri: str) -> str:
    m = re.search(r"level2_(\w+?_\w+?_\d+_\dD\d)_", uri)
    return m.group(1) if m else uri


def b64(arr: np.ndarray) -> str:
    return base64.b64encode(np.ascontiguousarray(arr, dtype="<f4").tobytes()).decode("ascii")


def find_peak(img: np.ndarray, x: float, y: float, radius: float, box: int = 2):
    """Brightest pixel within radius of (x, y), then a flux-weighted centroid over a (2*box+1)^2 window."""
    yy, xx = np.mgrid[0:N, 0:N]
    m = ((xx - x) ** 2 + (yy - y) ** 2 <= radius ** 2) & np.isfinite(img)
    if not m.any():
        return None
    vals = np.where(m, img, -np.inf)
    j, i = np.unravel_index(np.argmax(vals), img.shape)
    j0, j1, i0, i1 = max(0, j - box), min(N, j + box + 1), max(0, i - box), min(N, i + box + 1)
    sl = img[j0:j1, i0:i1]
    wgt = np.clip(np.nan_to_num(sl - np.nanmin(sl)), 0, None)
    if wgt.sum() <= 0:
        return float(i), float(j), float(img[j, i])
    gy, gx = np.mgrid[j0:j1, i0:i1]
    return float((gx * wgt).sum() / wgt.sum()), float((gy * wgt).sum() / wgt.sum()), float(img[j, i])


def saturated_near(stack_list, x: float, y: float, r: float = 3.0) -> int:
    yy, xx = np.mgrid[0:N, 0:N]
    m = (xx - x) ** 2 + (yy - y) ** 2 <= r * r
    return sum(int(np.count_nonzero(~np.isfinite(s[m]))) for s in stack_list if s is not None)


def aperture(img: np.ndarray, x: float, y: float, r: float = 2.5):
    yy, xx = np.mgrid[0:N, 0:N]
    m = (xx - x) ** 2 + (yy - y) ** 2 <= r * r
    vals = img[m]
    bad = int(np.count_nonzero(~np.isfinite(vals)))
    return float(np.nansum(vals)), bad


def num(v) -> float:
    """Float value of a possibly masked table cell (masked or NaN -> 0)."""
    if np.ma.is_masked(v):
        return 0.0
    f = float(v)
    return 0.0 if not np.isfinite(f) else f


def gaia_stars(center: SkyCoord, radius_deg: float):
    q = f"""
    SELECT ra, dec, pmra, pmdec, phot_g_mean_mag FROM gaia_dr3_source
    WHERE 1 = CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', {center.ra.deg}, {center.dec.deg}, {radius_deg}))
      AND phot_g_mean_mag < 18.5
    """
    try:
        return Irsa.query_tap(q).to_table()
    except Exception as e:  # noqa: BLE001
        print("  Gaia query failed:", e)
        return None


def build(tid: str, maxper: int, workers: int) -> None:
    cfg = TARGETS[tid]
    t0 = time.time()
    query_pos = pos_at(cfg, 2026.0)
    rows = find_images(query_pos.ra.deg, query_pos.dec.deg)
    seen, recs = set(), []
    for r in rows:
        k = obs_key(str(r["uri"]))
        if k in seen:
            continue
        seen.add(k)
        recs.append(dict(uri=str(r["uri"]), mjd=float(r["mjd"]), det=int(str(r["band"])[-1])))
    recs.sort(key=lambda d: d["mjd"])
    print(f"[{tid}] {len(rows)} images found, {len(recs)} unique, TAP {time.time() - t0:.0f}s")

    # sky visits (epochs)
    epochs, cur = [], [recs[0]]
    for a, b in zip(recs, recs[1:]):
        if b["mjd"] - a["mjd"] > EPOCH_GAP:
            epochs.append(cur)
            cur = []
        cur.append(b)
    epochs.append(cur)
    # Fields near the ecliptic poles are observed almost continuously: split long runs into ~45-day bins
    split = []
    for group in epochs:
        span = group[-1]["mjd"] - group[0]["mjd"]
        if span <= EPOCH_MAX_SPAN:
            split.append(group)
            continue
        nbin = int(np.ceil(span / EPOCH_BIN))
        edges = np.linspace(group[0]["mjd"], group[-1]["mjd"] + 1e-6, nbin + 1)
        for a, b in zip(edges[:-1], edges[1:]):
            part = [r for r in group if a <= r["mjd"] < b]
            if part:
                split.append(part)
    epochs = split

    # pick up to `maxper` images per epoch and detector, spread through the visit
    chosen = []
    for e, group in enumerate(epochs):
        for d in range(1, 7):
            items = [r for r in group if r["det"] == d]
            if len(items) > maxper:
                idx = np.linspace(0, len(items) - 1, maxper).round().astype(int)
                items = [items[i] for i in sorted(set(idx))]
            for r in items:
                chosen.append(dict(r, epoch=e))
    t_ref = float(np.mean([year_of(r["mjd"]) for r in chosen]))
    center = pos_at(cfg, t_ref)
    w_out = grid_wcs(center)
    print(f"[{tid}] {len(epochs)} epochs, reading {len(chosen)} patches, center {center.to_string('hmsdms', precision=1)} @ {t_ref:.2f}")

    def job(r):
        try:
            res = read_patch(r["uri"], center, HALF)
        except Exception as e:  # noqa: BLE001
            return r, None, None, str(e)
        if res is None:
            return r, None, None, "off detector"
        patch, w_in, x0, y0, h1 = res
        img = resample(patch, w_in, x0, y0, w_out)
        good = np.isfinite(img)
        if good.sum() < N * N * 0.3:
            return r, None, None, "mostly empty"
        _, med, _ = sigma_clipped_stats(img[good], sigma=3.0)
        try:  # wavelength this image sees at the target (each pixel of the filter sees a different one)
            tx, ty = (float(v) for v in w_in.world_to_pixel(pos_at(cfg, year_of(r["mjd"]))))
            lam = wavelength_at(r["uri"], r["det"], h1, tx, ty)
        except Exception:  # noqa: BLE001
            lam = None
        return r, img - med, lam, None

    t1 = time.time()
    imgs = {}
    fails = 0
    with cf.ThreadPoolExecutor(max_workers=workers) as ex:
        for r, img, lam, err in ex.map(job, chosen):
            if img is None:
                fails += 1
                continue
            imgs.setdefault((r["epoch"], r["det"]), []).append((r, img, lam))
    print(f"[{tid}] read {len(chosen) - fails} ok, {fails} skipped, {time.time() - t1:.0f}s")

    E = len(epochs)
    stacks = {d: [None] * E for d in range(1, 7)}
    counts = {d: [0] * E for d in range(1, 7)}
    for (e, d), lst in imgs.items():
        cube = np.stack([im for _, im, _ in lst])
        stacks[d][e] = np.nanmedian(cube, axis=0)
        counts[d][e] = len(lst)
    sigma = {}
    for d in range(1, 7):
        vals = np.concatenate([s[np.isfinite(s)] for s in stacks[d] if s is not None]) if any(s is not None for s in stacks[d]) else np.array([])
        sigma[d] = float(mad_std(vals)) if vals.size else 1.0
    allst = []
    for e in range(E):
        layers = [stacks[d][e] / sigma[d] for d in range(1, 7) if stacks[d][e] is not None]
        allst.append(np.nanmean(np.stack(layers), axis=0) if layers else None)
    sig_all = float(mad_std(np.concatenate([a[np.isfinite(a)] for a in allst if a is not None])))

    # epoch metadata
    ep_meta = []
    for e, group in enumerate(epochs):
        mj = [r["mjd"] for r in group]
        mid = Time(float(np.mean(mj)), format="mjd").datetime
        ep_meta.append(dict(
            mjdStart=round(min(mj), 3), mjdEnd=round(max(mj), 3), year=round(year_of(float(np.mean(mj))), 3),
            en=f"{MONTHS_EN[mid.month - 1]} {mid.year}", zh=f"{mid.year} 年 {mid.month} 月",
            images=[counts[d][e] for d in range(1, 7)], available=[r["det"] for r in group].__len__(),
        ))

    # target position per epoch: predicted from proper motion, refined on an unsaturated detector
    cx, cy = (float(v) for v in w_out.world_to_pixel(center))
    sat = {d: saturated_near(stacks[d], cx, cy) for d in range(1, 7)}
    best = cfg["best"]
    if sat[best] > 0:
        clean = [d for d in range(1, 7) if sat[d] == 0 and all(s is not None for s in stacks[d])]
        if clean:
            best = max(clean, key=lambda d: np.nanmax([np.nanmax(s) for s in stacks[d]]) / sigma[d])
    print(f"[{tid}] saturated pixels near target per detector: {sat}; measuring on D{best}")
    target = []
    for e in range(E):
        px, py = w_out.world_to_pixel(pos_at(cfg, ep_meta[e]["year"]))
        px, py = float(px), float(py)
        ref_img = stacks[best][e] if stacks[best][e] is not None else allst[e]
        meas, snr = None, 0.0
        moving = np.hypot(cfg["pmra"], cfg["pmdec"]) > 100  # mas/yr; slow stars keep their catalog position
        if ref_img is not None and moving:
            pk = find_peak(ref_img, px, py, 4.0)
            if pk:
                snr = pk[2] / (sigma[best] if stacks[best][e] is not None else sig_all)
                if snr > 6:
                    meas = pk
        x, y = (meas[0], meas[1]) if meas else (px, py)
        target.append(dict(x=round(x, 2), y=round((N - 1) - y, 2), predX=round(px, 2), predY=round((N - 1) - py, 2),
                           measured=meas is not None, snr=round(snr, 1)))
        print(f"[{tid}] epoch {e} {ep_meta[e]['en']}: pred ({px:.1f},{py:.1f}) meas {None if not meas else (round(meas[0], 1), round(meas[1], 1))} S/N {snr:.0f}")

    # brightness per detector per epoch. Unsaturated: aperture sum (r = 2.5 px).
    # Saturated core in any epoch: sum over a ring (r = 3.5-7 px) of the PSF wings, which still
    # scales with the star's brightness, so the relative change between visits stays meaningful.
    phot, phot_method = {}, {}
    for d in list(range(1, 7)):
        core_bad = any(
            stacks[d][e] is not None and aperture(stacks[d][e], target[e]["x"], (N - 1) - target[e]["y"])[1] > 0
            for e in range(E))
        row = []
        for e in range(E):
            s = stacks[d][e]
            if s is None:
                row.append(None)
                continue
            x, y = target[e]["x"], (N - 1) - target[e]["y"]
            if core_bad:
                outer, b1 = aperture(s, x, y, 7.0)
                inner, _ = aperture(np.nan_to_num(s), x, y, 3.5)
                f, bad = outer - inner, 0
            else:
                f, bad = aperture(s, x, y)
            row.append(dict(flux=round(f, 4), bad=bad))
        phot[str(d)] = row
        phot_method[str(d)] = "ring" if core_bad else "aperture"

    # Spectrum on the fly: every single image samples one wavelength at the target, so aperture
    # photometry on each image gives one point of the spectrum. Saturated points are skipped.
    pts, spec_sat = [], {str(d): 0 for d in range(1, 7)}
    yy, xx = np.mgrid[0:N, 0:N]
    for (e, d), lst in imgs.items():
        x, y = target[e]["x"], (N - 1) - target[e]["y"]
        m = (xx - x) ** 2 + (yy - y) ** 2 <= SPEC_R * SPEC_R
        for _, im, lam in lst:
            if lam is None:
                continue
            vals = im[m]
            if not np.all(np.isfinite(vals)):
                spec_sat[str(d)] += 1
                continue
            pts.append([round(lam, 4), round(float(vals.sum()) * MJYSR_PX_TO_MJY, 4), e])
    pts.sort()
    bins = []
    if pts:
        lam_arr = np.array([p[0] for p in pts])
        f_arr = np.array([p[1] for p in pts])
        edges = np.exp(np.arange(np.log(0.74), np.log(5.03), 1 / 40))   # R = 40 bins
        for a, b in zip(edges[:-1], edges[1:]):
            sel = (lam_arr >= a) & (lam_arr < b)
            if sel.sum() >= 2:
                bins.append([round(float(np.sqrt(a * b)), 4), round(float(np.median(f_arr[sel])), 4), int(sel.sum())])
    print(f"[{tid}] spectrum: {len(pts)} points, {len(bins)} bins, saturated per detector {spec_sat}")

    # Gaia DR3 stars in the field (positions at Gaia epoch 2016.0)
    gaia = []
    gt = gaia_stars(center, N * SCALE / 3600 * 0.75)
    if gt is not None:
        for g in gt:
            gx, gy = w_out.world_to_pixel(SkyCoord(float(g["ra"]) * u.deg, float(g["dec"]) * u.deg))
            if -1 <= gx <= N and -1 <= gy <= N:
                gaia.append(dict(x=round(float(gx), 2), y=round((N - 1) - float(gy), 2), g=round(float(g["phot_g_mean_mag"]), 2),
                                 pm=round(float(np.hypot(num(g["pmra"]), num(g["pmdec"]))), 1)))
    print(f"[{tid}] Gaia stars in field: {len(gaia)}")

    def pack(arrs, sig):
        return dict(sigma=sig, frames=[None if a is None else b64(np.flipud(a)) for a in arrs])

    out = dict(
        id=tid, n=N, scale=SCALE, center=dict(ra=round(center.ra.deg, 6), dec=round(center.dec.deg, 6), year=round(t_ref, 3)),
        epochs=ep_meta, dets={str(d): pack(stacks[d], sigma[d]) for d in range(1, 7)}, all=pack(allst, sig_all),
        target=target, measuredOn=best, saturated={str(d): sat[d] for d in range(1, 7)},
        phot=phot, photMethod=phot_method, gaia=gaia,
        spec=dict(unit="mJy", aperture=SPEC_R, points=pts, bins=bins, saturated=spec_sat), totalImages=len(recs), usedImages=len(chosen) - fails,
        source="SPHEREx DR1 + QR3 spectral images, NASA/IPAC IRSA",
    )
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{tid}.json").write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")

    # diagnostic montage: rows = epochs, columns = D1..D6 + all
    DIAG.mkdir(exist_ok=True)
    tiles = []
    for e in range(E):
        row = []
        for d in list(range(1, 7)) + [0]:
            s = allst[e] if d == 0 else stacks[d][e]
            sg = sig_all if d == 0 else sigma[d]
            if s is None:
                row.append(np.zeros((N, N)))
                continue
            x = np.clip(np.nan_to_num(np.flipud(s)) / (sg * 40), 0, 1)
            row.append(np.arcsinh(x * 10) / np.arcsinh(10))
        tiles.append(np.concatenate(row, axis=1))
    mont = (np.concatenate(tiles, axis=0) * 255).astype(np.uint8)
    Image.fromarray(mont).resize((mont.shape[1] * 4, mont.shape[0] * 4), Image.NEAREST).save(DIAG / f"{tid}.png")
    print(f"[{tid}] done in {time.time() - t0:.0f}s -> {OUT / (tid + '.json')}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("targets", nargs="*", default=list(TARGETS))
    ap.add_argument("--maxper", type=int, default=10, help="max images per epoch per detector")
    ap.add_argument("--workers", type=int, default=12)
    a = ap.parse_args()
    for t in a.targets:
        build(t, a.maxper, a.workers)
