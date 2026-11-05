#!/usr/bin/env python3
"""Measure KBO outfield fences on aerial imagery and write the app's fence profiles.

  park_fence.py fetch [PARK ...]      download VWorld z19 tiles (7x7 mosaic around parks.json `center`)
  park_fence.py measure [PARK ...]    foul lines -> home plate + CF bearing, wall trace, raw 1-degree profile
  park_fence.py profiles [--write]    smooth/model + official anchors -> print, or rewrite app/src/lib/stadiums.ts
  park_fence.py overlay PARK          draw the trace and foul lines on the mosaic (for checking by eye)

Imagery and intermediate files go to fixtures/parks/ (gitignored: VWorld imagery is not ours to redistribute).
Method, in short: home plate = intersection of the two chalk foul lines found in the image (they should meet at
~90 deg); for each 0.5 deg ray the wall is the outer edge of the warning track, picked between the first and the
strongest colour edge past the grass so the wall stays continuous; then per park a robust polynomial, a polygon
of straight walls or the square-corner model, shifted linearly in angle to pass through official distances.
"""
import io
import json
import math
import pathlib
import re
import subprocess
import sys

from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parents[2]
PARKS = json.loads((pathlib.Path(__file__).with_name("parks.json")).read_text())
PARKS.pop("_doc")
CACHE = ROOT / "fixtures" / "parks"
Z, R = 19, 3  # zoom, tiles on each side of the centre tile
UA = "kbo-scorebook-personal/0.1 (one-off stadium outline measurement)"


# ---------------------------------------------------------------- imagery
def tile_origin(lat, lon):
    n = 2 ** Z
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n)
    return x - R, y - R


def mosaic_path(park):
    tx0, ty0 = tile_origin(*PARKS[park]["center"])
    return CACHE / f"vw_{park}_z{Z}_{tx0}_{ty0}.png"


def fetch(park):
    tx0, ty0 = tile_origin(*PARKS[park]["center"])
    img = Image.new("RGB", ((2 * R + 1) * 256,) * 2)
    for dx in range(2 * R + 1):
        for dy in range(2 * R + 1):
            url = f"https://xdworld.vworld.kr/2d/Satellite/service/{Z}/{tx0 + dx}/{ty0 + dy}.jpeg"
            b = subprocess.run(["curl", "-sS", "-m", "30", "-A", UA, url], capture_output=True, check=True).stdout
            img.paste(Image.open(io.BytesIO(b)).convert("RGB"), (dx * 256, dy * 256))
    CACHE.mkdir(parents=True, exist_ok=True)
    img.save(mosaic_path(park))
    print(park, mosaic_path(park).name, file=sys.stderr)


class Mosaic:
    def __init__(self, park):
        self.im = Image.open(mosaic_path(park)).convert("RGB")
        self.W, self.H = self.im.size
        self.px = self.im.load()
        tx0, ty0 = tile_origin(*PARKS[park]["center"])
        lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (ty0 + self.H / 512) / 2 ** Z))))
        self.mpp = 156543.03392 * math.cos(math.radians(lat)) / 2 ** Z  # metres per pixel (Web Mercator)
        self.white = [0.0] * (self.W * self.H)
        for y in range(self.H):
            for x in range(self.W):
                r, g, b = self.px[x, y]
                self.white[y * self.W + x] = min(r, g, b) - 0.5 * (max(r, g, b) - min(r, g, b))

    def rgb(self, x, y):
        """bilinear colour at a sub-pixel position"""
        x0, y0 = int(x), int(y)
        fx, fy = x - x0, y - y0
        if not (0 <= x0 < self.W - 1 and 0 <= y0 < self.H - 1):
            return (0.0, 0.0, 0.0)
        c = [0.0, 0.0, 0.0]
        for dx, dy, w in ((0, 0, (1 - fx) * (1 - fy)), (1, 0, fx * (1 - fy)), (0, 1, (1 - fx) * fy), (1, 1, fx * fy)):
            p = self.px[x0 + dx, y0 + dy]
            for i in range(3):
                c[i] += p[i] * w
        return c

    def whiteness(self, x, y):
        xi, yi = int(x + 0.5), int(y + 0.5)
        return self.white[yi * self.W + xi] if 0 <= xi < self.W and 0 <= yi < self.H else 0.0


def u(deg):
    r = math.radians(deg)
    return math.cos(r), math.sin(r)


# ---------------------------------------------------------------- home plate from the foul lines
def foul_lines(m, hx, hy, cf, span_deg=12, span_m=10):
    """Search each chalk line near the guess (bright thin line: whiteness on it minus 1.2 m beside it, 8..95 m
    out), intersect them. Returns home (px), CF bearing and the angle between the lines (expect ~90)."""
    def score(ox, oy, phi, t):
        ux, uy = u(phi)
        nx, ny = -uy, ux
        off = 1.2 / m.mpp
        on = side = 0.0
        n = 0
        r = 8.0
        while r < 95:
            x, y = ox + nx * t + ux * r / m.mpp, oy + ny * t + uy * r / m.mpp
            on += m.whiteness(x, y)
            side += 0.5 * (m.whiteness(x + nx * off, y + ny * off) + m.whiteness(x - nx * off, y - ny * off))
            n += 1
            r += 0.5
        return (on - side) / n

    def best(ox, oy, phi0, sdeg, sm, dstep, tstep):
        top = None
        a = -sdeg
        while a <= sdeg + 1e-9:
            t = -sm / m.mpp
            while t <= sm / m.mpp + 1e-9:
                s = score(ox, oy, phi0 + a, t)
                if top is None or s > top[0]:
                    top = (s, phi0 + a, t)
                t += tstep / m.mpp
            a += dstep
        return top

    lines = []
    for side in (-45, 45):
        _, phi, t = best(hx, hy, cf + side, span_deg, span_m, 0.5, 0.25)
        o1x, o1y = hx - u(phi)[1] * t, hy + u(phi)[0] * t
        _, phi, t2 = best(o1x, o1y, phi, 0.6, 0.6, 0.05, 0.05)
        lines.append((phi, (o1x - u(phi)[1] * t2, o1y + u(phi)[0] * t2, *u(phi))))
    (aL, (x1, y1, dx1, dy1)), (aR, (x2, y2, dx2, dy2)) = lines
    s = ((x2 - x1) * dy2 - (y2 - y1) * dx2) / (dx1 * dy2 - dy1 * dx2)
    between = (aR - aL + 540) % 360 - 180
    return (x1 + s * dx1, y1 + s * dy1), aL + between / 2, between


# ---------------------------------------------------------------- wall trace
STEP = 0.1  # m along a ray


def ray_edges(m, hx, hy, bearing):
    """(first strong edge, strongest edge) 2..9 m past the grass edge along one ray, in metres from home."""
    ux, uy = u(bearing)
    cols = []
    d = 60.0
    while d < 140:
        cols.append(m.rgb(hx + ux * d / m.mpp, hy + uy * d / m.mpp))
        d += STEP
    grass = [c[1] > c[0] + 6 and c[1] >= c[2] - 4 for c in cols]
    gi = next((i for i in range(len(grass)) if not grass[i] and not any(grass[i:i + int(2.0 / STEP)])), None)
    if gi is None:
        return None
    w = int(0.6 / STEP)

    def mean(seg):
        return [sum(c[k] for c in seg) / len(seg) for k in range(3)]

    def edge(i):
        return math.dist(mean(cols[i - w:i]), mean(cols[i:i + w]))

    edges = [(edge(i), i) for i in range(gi + int(2.0 / STEP), min(len(cols) - w, gi + int(9.0 / STEP)))]
    if not edges:
        return None
    top = max(e for e, _ in edges)
    i = next(i for e, i in edges if e >= 0.6 * top)  # track -> wall padding
    while i + 1 < len(cols) and (i + 1 - gi) < 9.0 / STEP and edge(i + 1) >= edge(i):
        i += 1
    return 60 + i * STEP, 60 + max(edges)[1] * STEP


def trace(m, hx, hy, cf):
    """Wall distance every 0.5 deg (key: angle from CF): per ray the first or the strongest edge, chosen by a
    Viterbi pass so the wall stays continuous (jump cost, +0.5 m for the strongest), then outliers against the
    +-2 deg median dropped."""
    first, strong = {}, {}
    for a2 in range(-92, 93):
        e = ray_edges(m, hx, hy, cf + a2 / 2)
        if not e:
            continue
        if 85 <= e[0] <= 135:
            first[a2] = round(e[0], 2)
        if 85 <= e[1] <= 135:
            strong[a2] = round(e[1], 2)
    angles = [a for a in range(-92, 93) if a in first or a in strong]
    cands = {a: sorted({v for v in (first.get(a), strong.get(a)) if v is not None}) for a in angles}
    pen = lambda a, v: 0.0 if first.get(a) == v else 0.5  # noqa: E731
    best = {v: (pen(angles[0], v), [v]) for v in cands[angles[0]]}
    for prev, a in zip(angles, angles[1:]):
        best = {v: min(((c + min(abs(v - pv), 6.0) + pen(a, v), path + [v]) for pv, (c, path) in best.items()),
                       key=lambda t: t[0]) for v in cands[a]}
    chosen = dict(zip(angles, min(best.values(), key=lambda t: t[0])[1]))
    out = {}
    for a, v in chosen.items():
        win = sorted(chosen[k] for k in range(a - 4, a + 5) if k in chosen)
        if len(win) >= 5 and abs(v - win[len(win) // 2]) < 1.5:
            out[a] = v
    return out


def raw_profile(trace_pts, mpp, hx, hy, cf):
    """Distance every 1 deg from home to the traced wall (polyline through the trace points, both ends extended
    straight for 15 m along the last ~3 deg of wall); holes filled linearly in angle."""
    P = [((hx + u(cf + a / 2)[0] * v / mpp) * mpp, (hy + u(cf + a / 2)[1] * v / mpp) * mpp) for a, v in sorted(trace_pts.items())]
    for end in (0, -1):
        a, b = (P[6], P[0]) if end == 0 else (P[-7], P[-1])
        L = math.dist(a, b)
        e = ((b[0] - a[0]) / L, (b[1] - a[1]) / L)
        ext = [(b[0] + e[0] * k * 0.5, b[1] + e[1] * k * 0.5) for k in range(1, 31)]
        P = ext[::-1] + P if end == 0 else P + ext
    H = (hx * mpp, hy * mpp)

    def dist(a):
        ux, uy = u(cf + a)
        best = None
        for (x1, y1), (x2, y2) in zip(P, P[1:]):
            dx, dy = x2 - x1, y2 - y1
            den = ux * dy - uy * dx
            if abs(den) < 1e-12:
                continue
            t = ((x1 - H[0]) * dy - (y1 - H[1]) * dx) / den
            s = ((x1 - H[0]) * uy - (y1 - H[1]) * ux) / den
            if t > 0 and 0 <= s <= 1 and (best is None or t < best):
                best = t
        return best

    prof = [dist(a) for a in range(-45, 46)]
    known = [(i, v) for i, v in enumerate(prof) if v is not None]
    for i, v in enumerate(prof):
        if v is None:
            lo = max((k for k in known if k[0] < i), default=None, key=lambda k: k[0])
            hi = min((k for k in known if k[0] > i), default=None, key=lambda k: k[0])
            prof[i] = lo[1] + (hi[1] - lo[1]) * (i - lo[0]) / (hi[0] - lo[0]) if lo and hi else (lo or hi)[1]
    return [round(v, 1) for v in prof]


def measure(park):
    cfg = PARKS[park]
    m = Mosaic(park)
    if "mound" in cfg:
        mx, my, cf = cfg["mound"]
        hx, hy, between = mx - u(cf)[0] * 18.0 / m.mpp, my - u(cf)[1] * 18.0 / m.mpp, None
    else:
        (hx, hy), cf, between = foul_lines(m, *cfg["home"], *cfg.get("search", (12, 10)))
    pts = trace(m, hx, hy, cf)
    out = {"park": park, "mpp": m.mpp, "home": [hx, hy], "cf": cf, "foul_line_angle": between,
           "trace": {str(a / 2): v for a, v in sorted(pts.items())}, "raw": raw_profile(pts, m.mpp, hx, hy, cf)}
    (CACHE / f"{park}.measure.json").write_text(json.dumps(out, ensure_ascii=False))
    print(f"{park}: home {hx:.1f},{hy:.1f} cf {cf:.2f}"
          + (f" foul lines {between:.2f} deg" if between else " (mound)") + f" raw LF/CF/RF {out['raw'][0]}/{out['raw'][45]}/{out['raw'][90]}")


# ---------------------------------------------------------------- profiles
def at(p, a):
    x = a + 45
    i = min(89, int(x))
    return p[i] + (p[i + 1] - p[i]) * (x - i)


def bridge(p, half=5, thresh=1.5, maxrun=5):
    """values off the +-half deg running median by > thresh, in runs of <= maxrun deg, become a straight line"""
    n = len(p)
    bad = [abs(p[i] - sorted(p[max(0, i - half): i + half + 1])[len(p[max(0, i - half): i + half + 1]) // 2]) > thresh for i in range(n)]
    q = p[:]
    i = 0
    while i < n:
        if not bad[i]:
            i += 1
            continue
        j = i
        while j < n and bad[j]:
            j += 1
        if j - i <= maxrun and i > 0 and j < n:
            for k in range(i, j):
                q[k] = round(p[i - 1] + (p[j] - p[i - 1]) * (k - i + 1) / (j - i + 1), 1)
        i = j
    return q


def robust_poly(p, deg, exclude=()):
    """one polynomial r(a) for the whole wall, refit after dropping points off by > max(1 m, 2.5 x median)"""
    idx = [i for i in range(len(p)) if (i - 45) not in exclude]
    n = deg + 1
    for _ in range(6):
        X = [[((i - 45) / 45) ** k for k in range(n)] for i in idx]
        A = [[sum(r[a] * r[b] for r in X) for b in range(n)] + [sum(r[a] * p[i] for r, i in zip(X, idx))] for a in range(n)]
        for c in range(n):
            piv = max(range(c, n), key=lambda r: abs(A[r][c]))
            A[c], A[piv] = A[piv], A[c]
            for r in range(n):
                if r != c:
                    f = A[r][c] / A[c][c]
                    A[r] = [x - f * y for x, y in zip(A[r], A[c])]
        coef = [A[k][n] / A[k][k] for k in range(n)]
        f = lambda i: sum(cf * ((i - 45) / 45) ** k for k, cf in enumerate(coef))  # noqa: E731
        res = {i: p[i] - f(i) for i in range(len(p)) if (i - 45) not in exclude}
        mad = sorted(abs(v) for v in res.values())[len(res) // 2]
        new = [i for i, v in res.items() if abs(v) <= max(1.0, 2.5 * mad)]
        if new == idx:
            break
        idx = new
    return [f(i) for i in range(len(p))]


def rdp(pts, tol):
    def rec(a, b):
        (x1, y1), (x2, y2) = pts[a], pts[b]
        L = math.hypot(x2 - x1, y2 - y1) or 1e-9
        best, k = 0, None
        for i in range(a + 1, b):
            d = abs((x2 - x1) * (y1 - pts[i][1]) - (x1 - pts[i][0]) * (y2 - y1)) / L
            if d > best:
                best, k = d, i
        return rec(a, k)[:-1] + rec(k, b) if best > tol else [a, b]
    return rec(0, len(pts) - 1)


def polygon(verts, radii):
    """radius every 1 deg of straight walls between corners at (angle, radius)"""
    V = [(r * math.sin(math.radians(v)), r * math.cos(math.radians(v))) for v, r in zip(verts, radii)]
    out = []
    for i in range(91):
        a = math.radians(i - 45)
        ux, uy = math.sin(a), math.cos(a)
        j = next(j for j in range(len(verts) - 1) if verts[j] <= i - 45 <= verts[j + 1])
        (x1, y1), (x2, y2) = V[j], V[j + 1]
        ex, ey = x2 - x1, y2 - y1
        out.append((x1 * ey - y1 * ex) / (ux * ey - uy * ex))
    return out


def piecewise(points):
    """linear interpolation through sorted (angle, value) points"""
    def f(a):
        for (a0, c0), (a1, c1) in zip(points, points[1:]):
            if a0 <= a <= a1:
                return c0 + (c1 - c0) * (a - a0) / (a1 - a0)
        return points[0][1] if a < points[0][0] else points[-1][1]
    return f


def profile(park):
    cfg = PARKS[park]
    anchors = {float(k): v for k, v in cfg["anchors"].items()}
    kind = cfg["method"]["kind"]
    if kind == "square":  # side walls square to the foul lines at the pole distance, flat CF wall
        lf, c, rf = anchors[-45], anchors[0], anchors[45]
        return [round(min(lf / math.cos(math.radians(a + 45)) if a > -45 else lf, c / math.cos(math.radians(a)),
                          rf / math.cos(math.radians(45 - a)) if a < 45 else rf), 1) for a in range(-45, 46)], None
    raw = bridge(json.loads((CACHE / f"{park}.measure.json").read_text())["raw"])
    if kind == "polygon":
        pts = [(r * math.sin(math.radians(i - 45)), r * math.cos(math.radians(i - 45))) for i, r in enumerate(raw)]
        verts = [k - 45 for k in rdp(pts, cfg["method"]["tol"])]
        radii = [raw[v + 45] for v in verts]
        measured = polygon(verts, radii)
        for _ in range(30):  # move corners until the walls pass through the anchors
            cur = polygon(verts, radii)
            res = sorted((a, v - at(cur, a)) for a, v in anchors.items())
            if max(abs(r) for _, r in res) < 0.02:
                break
            radii = [r + piecewise(res)(v) for v, r in zip(verts, radii)]
        return [round(x, 1) for x in polygon(verts, radii)], measured
    lo, hi = cfg["method"].get("exclude", (0, -1))
    measured = robust_poly(raw, cfg["method"]["deg"], tuple(range(lo, hi + 1)))
    shift = piecewise(sorted((a, (v - at(measured, a)) if v is not None else 0.0) for a, v in anchors.items())) if anchors else (lambda a: 0.0)
    return [round(v + shift(i - 45), 1) for i, v in enumerate(measured)], measured


def labels(park, p):
    """[LF, LCF, CF, RCF, RF]: official values where src is 'ok', else the profile rounded like the app's readout"""
    cfg = PARKS[park]
    anchors = {float(k): v for k, v in cfg["anchors"].items()}
    out = []
    for a, s in zip((-45, -22.5, 0, 22.5, 45), cfg["src"]):
        out.append(anchors[a] if s == "ok" else math.floor(at(p, a) + 0.5))
    return out


def write_stadiums(results):
    path = ROOT / "app" / "src" / "lib" / "stadiums.ts"
    text = path.read_text()
    start, end = text.index("export const STADIUMS"), text.index("export const DEFAULT_FENCE")
    old = text[start:end]
    lines = ["export const STADIUMS: Record<string, Fence> = {\n"]
    for park in PARKS:
        if park not in results:
            continue
        p, measured = results[park]
        note = PARKS[park]["note"]
        if measured:
            note = f"measured {'/'.join(f'{at(measured, a):.1f}' for a in (-45, 0, 45))} (LF/CF/RF). " + note
        f = ",".join(f"{v:g}" for v in labels(park, p))
        src = ",".join(f"'{s}'" for s in PARKS[park]["src"])
        lines.append(f"  // {park}: {note}\n  {park}: {{f:[{f}], src:[{src}],\n    p:[{','.join(f'{v:g}' for v in p)}]}},\n")
    # parks without a profile (고척: dome) keep their existing entry
    for line in old.splitlines(keepends=True):
        m = re.match(r"\s*(\S+): \{", line)
        if m and m.group(1) not in results:
            lines.append(line)
    lines.append("};\n")
    path.write_text(text[:start] + "".join(lines) + text[end:])


def overlay(park):
    meas = json.loads((CACHE / f"{park}.measure.json").read_text())
    m = Mosaic(park)
    hx, hy = meas["home"]
    cf = meas["cf"]
    ov = m.im.copy()
    d = ImageDraw.Draw(ov)
    for s in (-45, 45):
        d.line([(hx, hy), (hx + u(cf + s)[0] * 130 / m.mpp, hy + u(cf + s)[1] * 130 / m.mpp)], fill=(255, 0, 255), width=2)
    for a, v in meas["trace"].items():
        x, y = hx + u(cf + float(a))[0] * v / m.mpp, hy + u(cf + float(a))[1] * v / m.mpp
        d.ellipse([x - 3, y - 3, x + 3, y + 3], fill=(255, 0, 0))
    out = CACHE / f"{park}.overlay.png"
    ov.save(out)
    print(out)


if __name__ == "__main__":
    cmd, args = sys.argv[1], sys.argv[2:]
    names = [a for a in args if not a.startswith("--")] or list(PARKS)
    if cmd == "fetch":
        for p in names:
            fetch(p)
    elif cmd == "measure":
        for p in names:
            measure(p)
    elif cmd == "profiles":
        results = {p: profile(p) for p in PARKS}
        for p, (prof, measured) in results.items():
            print(p, "labels", labels(p, prof), "| profile LF/CF/RF", prof[0], prof[45], prof[90])
        if "--write" in args:
            write_stadiums(results)
            print("wrote app/src/lib/stadiums.ts", file=sys.stderr)
    elif cmd == "overlay":
        overlay(args[0])
    else:
        sys.exit(__doc__)
