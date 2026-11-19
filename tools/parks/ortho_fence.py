"""MLB walls measured on high-resolution public orthophotos (0.15 m or finer), where the field's markings show.

Home plate. Where the foul lines are chalked into the outfield grass, home is where they cross (a line through the
chalk 30-90 m out on each side, its inliers spread over at least 20 m: with 0.05 m scatter and 30 or more points the
direction is then good to about 0.1 degree, 0.15 m at 100 m). Otherwise the base-path strips give the two
directions - not home itself: their centre lines are not the foul lines (at Nationals Park they cross about 1 m
behind the plate) - and home is placed along the axis by two features Rule 2.01 fixes relative to its back point: the
mound (9 ft radius, centre 59 ft out) and the infield dirt's edge (95 ft around the centre of the pitcher's plate,
whose front is 60 ft 6 in out and which is 6 in deep: 60 ft 9 in; the front edge would move home 0.08 m). Radii check
the image scale (2%), centres the axis (0.3 m) and each other (0.5 m). With chalk, at least one of them must be found
and agree with it (0.5 m); without, both. These are landscaping, laid out to a tolerance (the arc may be 94-96 ft):
they place home to a few decimetres, not centimetres.

Wall. Along a ray every 0.5 degrees: past 8 m of grass, the far end of the warning track - where the track colour
stops for 0.4 m, or steps sharply away from it (a light cap in front of a red bullpen). Where a photo has the stands'
shadow on the wall it is not read (ortho_parks.json lists those degrees per photo, as seen on it): shade turns a track
blue and a shadow's edge across it reads as a wall. A ray more than 2 m off the median of its neighbours within
2 degrees is dropped.

Flights. One photo can be wrong where another is right: at Nationals Park's left-field corner 2023 shows the track
ending 1 m short of where 2019, 2021 and 2025 all show it. So every flight is measured on its own and, sector by sector
(both corners, left, left-center, center, right-center, right), a ray where two or more flights agree within 0.5 m
takes their median; a flight that disagrees there with a flight that has agreed with another in the sector is left out
of the whole sector; a ray only one flight still sees takes its value, marked as seen once. The rays left must leave
no gap over 3 degrees and reach within 1 degree of both poles. Each whole degree takes the median of its rays; holes
are interpolated. A pole is the ray along the foul line when there is one, else where the straight wall through the
rays within 3 degrees meets the foul line - only if those rays lie within 0.3 m of one line that crosses the foul line
at 20 degrees or more and the crossing is within 2.5 m of a ray.

Acceptance, nothing fitted to any of it: Baseball Savant's measured lines and straightaway center within 1.5 m, its
deepest point within 1.5 m, its fair area within 2% (Savant's gaps are printed, not used: their bearing is unknown).
How each degree was got - agreed, seen once, interpolated, pole - is written with the profile.

    python3 ortho_fence.py fetch PARK      # photos -> fixtures/parks/ortho/ (gitignored: only measurements leave)
    python3 ortho_fence.py measure PARK    # registration, trace, checks; overlay and QA sheet next to the photos
"""
import io, json, math, sys, time, urllib.parse, urllib.request
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter
from savant import FT, measured, rows

HERE = Path(__file__).resolve().parent
CACHE = Path(__file__).resolve().parents[2] / 'fixtures' / 'parks' / 'ortho'
OUT = HERE / 'ortho_profiles.json'
HALF, N = 170, 3400  # metres each side of the park's coordinate, pixels across (0.1 m)
UA = {'User-Agent': 'openScoreBook park outline measurement (github.com/SpaceDLFactory/openScoreBook)'}
RUBBER_CENTRE_FT = 60.5 + 0.25
SECTORS = (('LF corner', -45, -38), ('left', -38, -23), ('left-center', -23, -8), ('center', -8, 8),
           ('right-center', 8, 23), ('right', 23, 38), ('RF corner', 38, 45))

def parks(): return json.loads((HERE / 'ortho_parks.json').read_text())

def photo(park, src): return CACHE / f"{park['key']}_{src['year']}.jpg"

def fetch(name):
    park = parks()[name]; lat, lon = park['center']
    R = 6378137.0
    x = math.radians(lon) * R; y = math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * R
    h = HALF / math.cos(math.radians(lat))  # Web Mercator stretches by 1/cos(lat)
    q = 4; step = 2 * h / q; sz = N // q  # in 16 pieces: one big export times out
    for src in park['sources']:
        if photo(park, src).exists(): continue
        img = Image.new('RGB', (N, N))
        for i in range(q):
            for j in range(q):
                bb = (x - h + i * step, y + h - (j + 1) * step, x - h + (i + 1) * step, y + h - j * step)
                p = urllib.parse.urlencode({'bbox': ','.join(map(str, bb)), 'bboxSR': 3857, 'imageSR': 3857, 'size': f'{sz},{sz}',
                                            'format': 'jpg', 'compressionQuality': 92, 'bandIds': '0,1,2', 'f': 'image'})
                for attempt in range(5):  # NAIP's server answers 502/504 now and then
                    try:
                        b = urllib.request.urlopen(urllib.request.Request(src['service'] + '/exportImage?' + p, headers=UA), timeout=180).read(); break
                    except OSError as e:
                        print(name, src['year'], 'retry', attempt, e, file=sys.stderr); time.sleep(10)
                else: raise SystemExit(f"{name} {src['year']}: no image")
                img.paste(Image.open(io.BytesIO(b)).convert('RGB'), (i * sz, j * sz))
        CACHE.mkdir(parents=True, exist_ok=True)
        img.save(photo(park, src), quality=93)
        print(name, src['year'], photo(park, src).name, file=sys.stderr)

class Photo:
    def __init__(self, path):
        self.raw = Image.open(path).convert('RGB')
        self.px = self.raw.filter(ImageFilter.GaussianBlur(0.8)).load()
        self.W, self.H = self.raw.size; self.mpp = 2 * HALF / self.W
    def rgb(self, x, y):
        xi, yi = int(round(x)), int(round(y))
        return self.px[xi, yi] if 0 <= xi < self.W and 0 <= yi < self.H else (0, 0, 0)

# ---- lines ----

def tls(pts):
    """total least squares line: centroid, unit direction"""
    n = len(pts); mx = sum(p[0] for p in pts) / n; my = sum(p[1] for p in pts) / n
    sxx = sum((p[0] - mx) ** 2 for p in pts); syy = sum((p[1] - my) ** 2 for p in pts); sxy = sum((p[0] - mx) * (p[1] - my) for p in pts)
    th = 0.5 * math.atan2(2 * sxy, sxx - syy)
    return (mx, my), (math.cos(th), math.sin(th))

def off(p, c, d): return abs((p[0] - c[0]) * -d[1] + (p[1] - c[1]) * d[0])

def chalk(m, hx, hy, deg, lo=30, hi=90, half=4.0):
    """the chalk foul line, from per-0.5 m cross-sections out in the grass: the brightest point that stands 25 above
    the section's median; the pair of points (15 m or more apart) that the most others line up with (0.15 m) seeds
    the fit. Returns centre, direction, inliers, and how far along the line they spread (m)."""
    white = lambda c: min(c) - 0.6 * (max(c) - min(c))
    ux, uy = math.cos(math.radians(deg)), math.sin(math.radians(deg)); nx, ny = -uy, ux
    pts = []; t = lo
    while t <= hi:
        vals = []; s = -half
        while s <= half:
            x = hx + (ux * t + nx * s) / m.mpp; y = hy + (uy * t + ny * s) / m.mpp
            vals.append((white(m.rgb(x, y)), x, y)); s += m.mpp / 2
        med = sorted(v[0] for v in vals)[len(vals) // 2]; best = max(vals)
        if best[0] - med > 25: pts.append(best[1:])
        t += 0.5
    tol = 0.15 / m.mpp; seed = None
    for i in range(len(pts)):
        for j in range(i + 1, len(pts)):
            L = math.dist(pts[i], pts[j])
            if L * m.mpp < 15: continue
            d = ((pts[j][0] - pts[i][0]) / L, (pts[j][1] - pts[i][1]) / L)
            k = sum(off(p, pts[i], d) < tol for p in pts)
            if not seed or k > seed[0]: seed = (k, pts[i], d)
    if not seed: return None
    pts = [p for p in pts if off(p, seed[1], seed[2]) < tol]
    c, d = tls(pts)
    if d[0] * ux + d[1] * uy < 0: d = (-d[0], -d[1])
    along = [(p[0] - c[0]) * d[0] + (p[1] - c[1]) * d[1] for p in pts]
    return c, d, len(pts), (max(along) - min(along)) * m.mpp

def base_path(m, hx, hy, deg, lo=5, hi=25):
    """the centre line of a base-path strip (tan dirt): per 0.25 m cross-section, the middle of what stands out as
    dirt, refitted twice in a narrower band"""
    dirt = lambda c: (c[0] - c[2]) + 0.1 * sum(c) - 0.8 * max(0, c[1] - c[0])
    ux, uy = math.cos(math.radians(deg)), math.sin(math.radians(deg)); ox, oy = hx, hy
    for band in (2.5, 1.5, 1.2):
        nx, ny = -uy, ux; pts = []; t = lo
        while t <= hi:
            vals = []; s = -band
            while s <= band:
                x = ox + (ux * t + nx * s) / m.mpp; y = oy + (uy * t + ny * s) / m.mpp
                vals.append((dirt(m.rgb(x, y)), x, y)); s += m.mpp / 2
            top = max(v[0] for v in vals); low = sorted(v[0] for v in vals)[len(vals) // 4]
            if top - low > 30:
                inside = [v for v in vals if v[0] > (top + low) / 2]
                pts.append((sum(v[1] for v in inside) / len(inside), sum(v[2] for v in inside) / len(inside)))
            t += 0.25
        if len(pts) < 20: return None
        c, d = tls(pts)
        if d[0] * ux + d[1] * uy < 0: d = (-d[0], -d[1])
        k = (hx - c[0]) * d[0] + (hy - c[1]) * d[1]; ox, oy = c[0] + d[0] * k, c[1] + d[1] * k; ux, uy = d
    return c, d, len(pts)

def cross(l1, l2):
    (p1, d1), (p2, d2) = l1[:2], l2[:2]
    t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / (d1[0] * d2[1] - d1[1] * d2[0])
    return p1[0] + d1[0] * t, p1[1] + d1[1] * t

# ---- home plate from the rules ----

def circle_fit(P):
    n = len(P); mx = sum(p[0] for p in P) / n; my = sum(p[1] for p in P) / n
    suu = sum((p[0] - mx) ** 2 for p in P); svv = sum((p[1] - my) ** 2 for p in P); suv = sum((p[0] - mx) * (p[1] - my) for p in P)
    a = (sum((p[0] - mx) ** 3 for p in P) + sum((p[0] - mx) * (p[1] - my) ** 2 for p in P)) / 2
    b = (sum((p[1] - my) ** 3 for p in P) + sum((p[1] - my) * (p[0] - mx) ** 2 for p in P)) / 2
    det = suu * svv - suv * suv; uc = (a * svv - b * suv) / det; vc = (b * suu - a * suv) / det
    return mx + uc, my + vc, math.sqrt(uc * uc + vc * vc + (suu + svv) / n)

def circle(m, cx, cy, degs, r0, r1, tol):
    """a dirt circle's edge against grass: per ray, the first step with 0.5 m of dirt before it and 0.5 m of grass
    after; fitted three times, dropping edge points more than tol metres off"""
    step = m.mpp / 2; n = int(0.5 / step); good = []
    for _ in range(3):
        pts = []
        for k in degs:
            t = math.radians(k); seq = []; r = r0
            while r < r1:
                c = m.rgb(cx + math.cos(t) * r / m.mpp, cy + math.sin(t) * r / m.mpp); seq.append((r, c[0] - c[1] > 12)); r += step
            for i in range(n, len(seq) - n):
                if all(q[1] for q in seq[i - n:i]) and not any(q[1] for q in seq[i:i + n]):
                    rr = (seq[i - 1][0] + seq[i][0]) / 2; pts.append((cx + math.cos(t) * rr / m.mpp, cy + math.sin(t) * rr / m.mpp)); break
        if len(pts) < 20: return None
        X, Y, R = circle_fit(pts)
        good = [p for p in pts if abs(math.hypot(p[0] - X, p[1] - Y) - R) * m.mpp < tol]
        if len(good) < 20: return None
        cx, cy, R = circle_fit(good)
    return cx, cy, R * m.mpp, len(good) / len(degs)

def register(m, hx, hy, axis, by_chalk, log):
    """home as the chalk (by_chalk) or the base paths (moved along the axis) give it, checked by the rule features"""
    u = (math.cos(math.radians(axis)), math.sin(math.radians(axis)))
    est = {}
    for name, out_ft, r_ft, r0, r1, degs, tol in (
            ('mound', 59, 9, 1.0, 4.5, [k / 2 for k in range(720)], 0.3),
            ('infield arc', RUBBER_CENTRE_FT, 95, 24, 34, [axis + k / 2 for k in range(-100, 101)], 0.4)):
        f = circle(m, hx + u[0] * out_ft * FT / m.mpp, hy + u[1] * out_ft * FT / m.mpp, degs, r0, r1, tol)
        if not f: log(f'  {name}: edge not found'); continue
        X, Y, R, share = f
        dx, dy = (X - hx) * m.mpp, (Y - hy) * m.mpp; along, across = dx * u[0] + dy * u[1], -dx * u[1] + dy * u[0]
        bad = 'radius off by more than 2%' if abs(R - r_ft * FT) > 0.02 * r_ft * FT else 'centre off the axis' if abs(across) > 0.3 else ''
        log(f'  {name}: radius {R:.2f} m (rule {r_ft * FT:.2f}), edge on {share:.0%} of rays; centre {along:.2f} m out '
            f'(rule {out_ft * FT:.2f}), {across:+.2f} m off the axis' + (f' - not used: {bad}' if bad else ''))
        if not bad: est[name] = along - out_ft * FT
    need = 1 if by_chalk else 2
    if len(est) < need: raise SystemExit(f'{len(est)} rule feature(s) usable, {need} needed: home not checked')
    if by_chalk:
        for name, v in est.items(): log(f'  {name} puts home {v:+.2f} m along the axis from the chalk')
        if any(abs(v) > 0.5 for v in est.values()): raise SystemExit('a rule feature disagrees with the chalk by more than 0.5 m')
        return hx, hy
    if max(est.values()) - min(est.values()) > 0.5: raise SystemExit(f'mound and arc disagree about home: {est}')
    shift = sum(est.values()) / len(est)
    log(f'  home {shift:+.2f} m along the axis from where the base paths cross')
    return hx + u[0] * shift / m.mpp, hy + u[1] * shift / m.mpp

def home_plate(m, park, log):
    hx, hy = park['home']; lf, rf = park['lines']
    l1, l2 = chalk(m, hx, hy, lf), chalk(m, hx, hy, rf)
    by_chalk = False
    if l1 and l2:
        spread = (math.degrees(math.atan2(l2[1][1], l2[1][0])) - math.degrees(math.atan2(l1[1][1], l1[1][0]))) % 360
        log(f'  chalk on {l1[2]}/{l2[2]} of 121 sections, spread over {l1[3]:.0f}/{l2[3]:.0f} m, lines {spread:.2f} deg apart')
        by_chalk = min(l1[2], l2[2]) >= 30 and min(l1[3], l2[3]) >= 20 and abs(spread - 90) < 0.5
    if not by_chalk:
        l1, l2 = base_path(m, hx, hy, lf), base_path(m, hx, hy, rf)
        if not (l1 and l2): raise SystemExit('neither chalk nor base paths found')
        spread = (math.degrees(math.atan2(l2[1][1], l2[1][0])) - math.degrees(math.atan2(l1[1][1], l1[1][0]))) % 360
        log(f'  base paths {spread:.2f} deg apart')
        if abs(spread - 90) > 0.5: raise SystemExit('base paths not square')
    axis = math.degrees(math.atan2(l1[1][1], l1[1][0])) + spread / 2
    hx, hy = register(m, *cross(l1, l2), axis, by_chalk, log)
    return hx, hy, axis, 'chalk foul lines' if by_chalk else 'mound and infield arc'

# ---- wall ----

def kind(c):
    """G grass, T warning track, O anything else, by log(red) - log(green), which a photo's overall colour balance and
    shade (both close to scalings) move little: grass -0.14 to -0.30 on every flight, the track +0.2 to +0.6 in sun
    (2019's olive-looking track included) and +0.08 in the shade of a tall wall; padded faces (navy 43,43,59: 0, teal
    66,87,99: -0.27) and grey caps fall below. Deep shade turns the track blue (2025: -0.47) - unread, not misread.
    Red brick behind a wall reads as track; the colour-step rule in wall() stops at the cap in front of it."""
    q = math.log(c[0] + 1) - math.log(c[1] + 1)
    return 'G' if q < -0.08 else 'T' if q > 0.04 else 'O'

def wall(m, hx, hy, axis, a, rmin=60, rmax=145):
    ux, uy = math.cos(math.radians(axis + a)), math.sin(math.radians(axis + a))
    step = m.mpp; need = round(0.4 / step); back = round(0.5 / step); ahead = round(0.3 / step)
    cls = []; r = rmin
    while r <= rmax:
        c = m.rgb(hx + ux * r / m.mpp, hy + uy * r / m.mpp); cls.append((r, kind(c), c)); r += step
    mean = lambda q: [sum(x[2][k] for x in q) / len(q) for k in range(3)]
    run, i = 0.0, 0
    while i < len(cls) and run < 8:
        run = run + step if cls[i][1] == 'G' else 0.0; i += 1
    while i < len(cls) and cls[i][1] != 'T': i += 1
    if i >= len(cls) - need: return None
    t0 = cls[i][0]
    while i < len(cls) - need:
        stepped = False
        if i - back >= 0 and all(q[1] == 'T' for q in cls[i - back:i]):
            m0 = mean(cls[i - back:i])
            stepped = math.dist(m0, mean(cls[i:i + ahead])) >= 25 and all(math.dist(m0, q[2]) >= 20 for q in cls[i:i + ahead])
        if stepped or (cls[i][1] != 'T' and all(q[1] != 'T' for q in cls[i:i + need])):
            width = cls[i - 1][0] - t0
            # a warning track is 3-5 m wide; near the poles the ray also runs along the track in foul ground
            return round((cls[i - 1][0] + cls[i][0]) / 2, 2) if 1.5 <= width <= (8 if abs(a) < 40 else 35) else None
        i += 1
    return None

def trace(m, hx, hy, axis, shade=()):
    """rays every 0.5 degrees outside the shaded stretches; those more than 2 m off the median of their neighbours
    within 2 degrees dropped"""
    rays = {k / 2: wall(m, hx, hy, axis, k / 2) for k in range(-90, 91) if not any(lo <= k / 2 <= hi for lo, hi in shade)}
    rays = {a: v for a, v in rays.items() if v}
    keep, dropped = {}, []
    for a, v in rays.items():
        near = sorted(w for b, w in rays.items() if b != a and abs(b - a) <= 2)
        (keep.__setitem__(a, v) if near and abs(v - near[len(near) // 2]) <= 2 else dropped.append(a))
    return keep, dropped

def coverage(rays):
    """the rays must reach within 1 degree of both poles and leave no gap over 3 degrees between them"""
    a = sorted(rays)
    if not a or a[0] > -44 or a[-1] < 44: raise SystemExit(f'wall not seen near a pole (rays from {a[0] if a else None} to {a[-1] if a else None})')
    gaps = [(x, y) for x, y in zip(a, a[1:]) if y - x > 3]
    if gaps: raise SystemExit(f'wall not seen between {gaps} deg')

def pole(rays, side):
    """the wall along a foul line (side -1 left, +1 right): the observed ray there, checked against the straight wall
    through the rays within 3 degrees of it, or else that wall carried to the foul line. Returns (metres, observed)."""
    near = sorted((a, r) for a, r in rays.items() if 42 <= side * a < 45)
    if len(near) < 4 or abs(near[-1][0] - near[0][0]) < 1.5: raise SystemExit(f'pole {side:+d}: too few rays within 3 degrees')
    xy = [(r * math.sin(math.radians(a)), r * math.cos(math.radians(a))) for a, r in near]
    c, d = tls(xy)
    worst = max(off(p, c, d) for p in xy)
    if worst > 0.3: raise SystemExit(f'pole {side:+d}: the wall near it is not one straight run ({worst:.2f} m off a line)')
    ux, uy = math.sin(math.radians(45 * side)), math.cos(math.radians(45 * side))
    den = ux * d[1] - uy * d[0]
    if abs(den) < math.sin(math.radians(20)): raise SystemExit(f'pole {side:+d}: the wall runs too close to parallel with the foul line')
    t = (c[0] * d[1] - c[1] * d[0]) / den
    if min(math.dist((t * ux, t * uy), p) for p in xy) > 2.5: raise SystemExit(f'pole {side:+d}: carried more than 2.5 m past the last ray')
    obs = rays.get(45.0 * side)
    if obs is not None:
        if abs(obs - t) > 0.5: raise SystemExit(f'pole {side:+d}: the ray along the line ({obs}) and the wall near it ({t:.2f}) disagree')
        return obs, True
    return t, False

def profile(rays, once=frozenset()):
    """91 whole degrees and how each was got: m agreed, s seen by one flight only (each as the ray whose value the
    degree took), i interpolated, p pole from the wall near it"""
    coverage(rays)
    p, how = [], []
    for i in range(91):
        near = sorted((v, a) for a, v in rays.items() if abs(a - (i - 45)) <= 0.5)
        pick = near[len(near) // 2] if near else None
        p.append(pick[0] if pick else None); how.append('i' if not pick else 's' if pick[1] in once else 'm')
    for i, side in ((0, -1), (90, 1)):
        p[i], seen = pole(rays, side); how[i] = ('s' if 45.0 * side in once else 'm') if seen else 'p'
    i = 0
    while i < 91:
        if p[i] is None:
            j = i
            while p[j] is None: j += 1
            for k in range(i, j): p[k] = p[i - 1] + (p[j] - p[i - 1]) * (k - i + 1) / (j - i + 1)
            i = j
        else: i += 1
    return [round(v, 1) for v in p], ''.join(how)

def area(p):
    """fair territory inside the wall as the app draws it: home plate and straight segments between the degrees"""
    pts = [(0.0, 0.0)] + [(r * math.sin(math.radians(i - 45)), r * math.cos(math.radians(i - 45))) for i, r in enumerate(p)]
    return abs(sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1]))) / 2

def at(p, deg):
    """the profile between whole degrees (straight segments, as the app draws it, in polar terms close enough here)"""
    u = deg + 45; i = min(89, int(u))
    return p[i] + (p[i + 1] - p[i]) * (u - i)

def combine(flights, log, tol=0.5):
    """flights: [(year, rays)] -> rays, and the ones seen by one flight only (see the module's notes on Flights)"""
    def agree(fl, angles):
        """rays where the largest group of flights within tol holds 2 or more and no other group of that size stands
        apart from it; the rest of the rays, those with two equally supported readings among them"""
        agreed, members, split = {}, {}, []
        for a in angles:
            vals = sorted((rays[a], y) for y, rays in fl if a in rays)
            size = max((j - i for i in range(len(vals)) for j in range(i + 1, len(vals) + 1) if vals[j - 1][0] - vals[i][0] <= tol), default=0)
            if size < 2: continue
            starts = [i for i in range(len(vals) - size + 1) if vals[i + size - 1][0] - vals[i][0] <= tol]
            if starts[-1] - starts[0] >= size: split.append(a); continue  # two separate groups, equally supported
            g = min((vals[i:i + size] for i in starts), key=lambda g: g[-1][0] - g[0][0])
            vs = [v for v, _ in g]; n = len(vs)
            agreed[a] = vs[n // 2] if n % 2 else (vs[n // 2 - 1] + vs[n // 2]) / 2; members[a] = {y for _, y in g}
        return agreed, members, split
    out, once = {}, set()
    for name, lo, hi in SECTORS:
        angles = [k / 2 for k in range(2 * lo, 2 * hi + 1) if lo <= k / 2 < hi or k / 2 == hi == 45]
        agreed, members, split = agree(flights, angles)
        # in this sector, how often each flight is in an agreeing group, and how often it reads against one - or,
        # where no group formed, against another flight's ray: one who disagrees as often as it agrees is left out
        score = {y: [0, 0] for y, _ in flights}
        for a in angles:
            seen = [(y, rays[a]) for y, rays in flights if a in rays]
            if a in agreed:
                for y, v in seen: score[y][0 if y in members[a] else 1] += 1
            elif len(seen) >= 2 and max(v for _, v in seen) - min(v for _, v in seen) > tol:
                for y, _ in seen: score[y][1] += 1
        left_out = {y for y, (yes, no) in score.items() if no and no >= yes}
        kept = [(y, rays) for y, rays in flights if y not in left_out]
        agreed, members, split = agree(kept, angles)
        single = {}
        for a in angles:
            if a in agreed: out[a] = agreed[a]; continue
            seen = [(y, rays[a]) for y, rays in kept if a in rays]
            if len(seen) == 1: out[a] = seen[0][1]; once.add(a); single[seen[0][0]] = single.get(seen[0][0], 0) + 1
        log(f'    {name:12s} {len(agreed):2d}/{len(angles)} rays agreed' + (f", seen once: {single}" if single else '')
            + (f', left out: {sorted(left_out)}' if left_out else '') + (f', split evenly (dropped): {split}' if split else ''))
    return out, once

def draw(m, hx, hy, axis, p, rays_by, path_overlay, path_qa):
    colours = [(255, 230, 0), (0, 255, 255), (255, 0, 255), (255, 140, 0), (120, 255, 120)]
    im = m.raw.copy(); d = ImageDraw.Draw(im)
    pt = lambda a, r: (hx + math.cos(math.radians(axis + a)) * r / m.mpp, hy + math.sin(math.radians(axis + a)) * r / m.mpp)
    for s in (-45, 45): d.line([(hx, hy), pt(s, 100)], fill=(255, 255, 255), width=2)
    d.line([pt(i - 45, v) for i, v in enumerate(p)], fill=colours[0], width=2)
    for k, (_, rays) in enumerate(rays_by):
        for a, v in rays.items(): x, y = pt(a, v); d.ellipse([x - 3, y - 3, x + 3, y + 3], outline=colours[k % len(colours)])
    R = 140 / m.mpp; im.crop((int(hx - R), int(hy - R), int(hx + R), int(hy + R))).resize((1400, 1400)).save(path_overlay)
    tiles = []
    for a in range(-45, 46, 5):
        x, y = pt(a, at(p, a)); c = im.crop((int(x - 60), int(y - 60), int(x + 60), int(y + 60))).resize((240, 240), Image.LANCZOS)
        ImageDraw.Draw(c).text((3, 3), f'{a:+d}', fill=(255, 255, 255)); tiles.append(c)
    sheet = Image.new('RGB', (240 * 7, 240 * 3 + 24))
    for k, t in enumerate(tiles): sheet.paste(t, ((k % 7) * 240, (k // 7) * 240))
    ImageDraw.Draw(sheet).text((4, 240 * 3 + 6), 'line: published profile   circles: ' + '  '.join(f'{y}' for y, _ in rays_by), fill=(255, 255, 255))
    sheet.save(path_qa)

def measure(name):
    park = parks()[name]; log = print
    year = park['savant']
    meas, rec = measured(year)[name], rows(year)[name]
    runs = []
    for src in park['sources']:
        m = Photo(photo(park, src)); log(f"{name}, {src['year']} photo:")
        try:
            hx, hy, axis, how = home_plate(m, park, log)
        except SystemExit as e:
            log(f'  not used: {e}'); continue
        rays, dropped = trace(m, hx, hy, axis, src.get('shade', ()))
        log(f'  wall traced on {len(rays)}/181 rays' + (f"; not read in shade: {src['shade']}" if src.get('shade') else '')
            + (f'; dropped as off their neighbours: {dropped}' if dropped else ''))
        runs.append((src, m, hx, hy, axis, how, rays))
    if len(runs) < 2: raise SystemExit(f'{name}: fewer than two flights placed home plate')
    log('  flights combined, sector by sector:')
    rays, once = combine([(r[0]['year'], r[6]) for r in runs], log)
    p, made = profile(rays, once)
    log(f"  profile: {made.count('m')} degrees agreed, {made.count('s')} seen once at {[i - 45 for i, c in enumerate(made) if c == 's']}, "
        f"interpolated at {[i - 45 for i, c in enumerate(made) if c == 'i']}, poles {made[0]}/{made[90]}")
    src, m, hx, hy, axis = runs[0][:5]  # drawn on the first photo that placed home
    draw(m, hx, hy, axis, p, [(r[0]['year'], r[6]) for r in runs], CACHE / f"{park['key']}.overlay.png", CACHE / f"{park['key']}.qa.png")
    gates = {'LF': (p[0], meas[0]), 'CF': (p[45], meas[2]), 'RF': (p[90], meas[4]), 'deepest': (max(p), rec['distance_deepest'] * FT)}
    fair, savant_fair = area(p), rec['fence_area'] * FT * FT
    log(f'  vs Savant {year} (m): ' + '  '.join(f'{k} {a:.1f}/{b:.1f} ({a - b:+.1f})' for k, (a, b) in gates.items())
        + f'  area {fair:.0f}/{savant_fair:.0f} m2 ({fair / savant_fair - 1:+.1%})'
        + f'  [gaps, bearing unknown so not checked: 17.5 deg {at(p, -17.5):.1f}/{meas[1]:.1f}, {at(p, 17.5):.1f}/{meas[3]:.1f}]')
    if not (all(abs(a - b) <= 1.5 for a, b in gates.values()) and abs(fair / savant_fair - 1) <= 0.02):
        raise SystemExit(f'{name}: Savant checks failed, not written')
    used = [r[0] for r in runs]
    data = json.loads(OUT.read_text()) if OUT.exists() else {'profiles': {}, 'sources': {}}
    data['profiles'][name] = p
    data['sources'][name] = {
        'photos': [f"{s['service']} ({s['flown']})" for s in used],
        'credit': ' / '.join(sorted({s['credit'] for s in used})), 'licence': ' / '.join(sorted({s['licence'] for s in used})),
        'licence_url': ' '.join(sorted({s['licence_url'] for s in used})),
        'home plate': {s['year']: r[5] for s, r in zip(used, runs)},
        'degrees': made + ' (m agreed by two or more photos, s seen by one only, i interpolated, p pole from the wall near it; LF line first)',
        'checked against': f'Baseball Savant {year}'}
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1) + '\n')
    log(f'{name}: written to {OUT.name}')

if __name__ == '__main__':
    cmd, name = sys.argv[1], sys.argv[2]
    {'fetch': fetch, 'measure': measure}[cmd](name)
