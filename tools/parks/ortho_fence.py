"""MLB walls measured on high-resolution public orthophotos (0.15 m or finer), where the field's markings show.

Home plate. Where the foul lines are chalked into the outfield grass, home is where they cross (a line through the
chalk 30-90 m out on each side). Otherwise the base-path strips give the two directions - not home itself: their
centre lines are not the foul lines (at Nationals Park they cross 1 m behind the plate) - and home is placed along the
axis by two features the rules fix relative to it: the mound (9 ft radius, centre 59 ft out) and the infield grass
arc (95 ft around the front of the rubber, 60.5 ft out). Their radii check the image scale (within 2%), their
centres the axis (within 0.3 m) and each other (within 0.5 m); with chalk, each must agree with it within 0.5 m.

Wall. Along a ray every 0.5 degrees: past 8 m of grass, the far end of the warning track - where the track colour
stops for 0.4 m, or steps sharply away from it (a light cap in front of a red bullpen). Seen from off to one side, a
wall's field face shows as a band beyond its foot, so the track still ends at the foot; a wall leaning over the track
would hide it, which is what the second photo, from another flight, measured on its own, is for. A ray more than 2 m
off the median of its neighbours within 2 degrees is dropped (something lying on the track), each whole degree takes
the median of its rays, the poles come from a line through the rays within 3 degrees of them, and holes of up to
3 degrees are interpolated; anything longer rejects the park.

A park is written to ortho_profiles.json only if checks that nothing was fitted to all pass: Baseball Savant's
measured lines, gaps (17.5 degrees off center) and center within 1.5 m, its deepest point within 1.5 m, its fair area
within 2%, and the second photo within 0.5 m (median) on the rays both trace.

    python3 ortho_fence.py fetch PARK      # photos -> fixtures/parks/ortho/ (gitignored: only measurements leave)
    python3 ortho_fence.py measure PARK    # registration, trace, checks; overlay PNGs next to the photos
"""
import io, json, math, sys, urllib.parse, urllib.request
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter
from savant import FT, measured, rows

HERE = Path(__file__).resolve().parent
CACHE = Path(__file__).resolve().parents[2] / 'fixtures' / 'parks' / 'ortho'
PARKS = json.loads((HERE / 'ortho_parks.json').read_text())
OUT = HERE / 'ortho_profiles.json'
HALF, N = 170, 3400  # metres each side of the park's coordinate, pixels across (0.1 m)
UA = {'User-Agent': 'openScoreBook park outline measurement (github.com/SpaceDLFactory/openScoreBook)'}

def photo(name, src): return CACHE / f"{PARKS[name]['key']}_{src['year']}.jpg"

def fetch(name):
    lat, lon = PARKS[name]['center']
    R = 6378137.0
    x = math.radians(lon) * R; y = math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * R
    h = HALF / math.cos(math.radians(lat))  # Web Mercator stretches by 1/cos(lat)
    q = 4; step = 2 * h / q; sz = N // q  # in 16 pieces: one big export times out
    for src in PARKS[name]['sources']:
        img = Image.new('RGB', (N, N))
        for i in range(q):
            for j in range(q):
                bb = (x - h + i * step, y + h - (j + 1) * step, x - h + (i + 1) * step, y + h - j * step)
                p = urllib.parse.urlencode({'bbox': ','.join(map(str, bb)), 'bboxSR': 3857, 'imageSR': 3857, 'size': f'{sz},{sz}',
                                            'format': 'jpg', 'compressionQuality': 92, 'bandIds': '0,1,2', 'f': 'image'})
                b = urllib.request.urlopen(urllib.request.Request(src['service'] + '/exportImage?' + p, headers=UA), timeout=180).read()
                img.paste(Image.open(io.BytesIO(b)).convert('RGB'), (i * sz, j * sz))
        CACHE.mkdir(parents=True, exist_ok=True)
        img.save(photo(name, src), quality=93)
        print(name, src['year'], photo(name, src).name, file=sys.stderr)

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
    the section's median; the pair of points that the most others line up with (0.15 m) seeds the fit"""
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
    tol = 0.15 / m.mpp
    seed = max(((pts[i], pts[j]) for i in range(0, len(pts), 2) for j in range(i + 1, len(pts), 2)
                if math.dist(pts[i], pts[j]) * m.mpp >= 15),
               key=lambda ab: sum(off(p, ab[0], ((ab[1][0] - ab[0][0]) / math.dist(*ab), (ab[1][1] - ab[0][1]) / math.dist(*ab))) < tol for p in pts),
               default=None)
    if not seed: return None
    a, b = seed; d = ((b[0] - a[0]) / math.dist(a, b), (b[1] - a[1]) / math.dist(a, b))
    pts = [p for p in pts if off(p, a, d) < tol]
    c, d = tls(pts)
    if d[0] * ux + d[1] * uy < 0: d = (-d[0], -d[1])
    return c, d, len(pts)

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
    """offsets along the axis (m) of home as the mound and the infield arc place it, from hx, hy"""
    u = (math.cos(math.radians(axis)), math.sin(math.radians(axis)))
    est = {}
    for name, out_ft, r_ft, r0, r1, degs, tol in (
            ('mound', 59, 9, 1.0, 4.5, [k / 2 for k in range(720)], 0.3),
            ('infield arc', 60.5, 95, 24, 34, [axis + k / 2 for k in range(-100, 101)], 0.4)):
        f = circle(m, hx + u[0] * out_ft * FT / m.mpp, hy + u[1] * out_ft * FT / m.mpp, degs, r0, r1, tol)
        if not f: log(f'  {name}: edge not found'); continue
        X, Y, R, share = f
        dx, dy = (X - hx) * m.mpp, (Y - hy) * m.mpp; along, across = dx * u[0] + dy * u[1], -dx * u[1] + dy * u[0]
        bad = 'radius off by more than 2%' if abs(R - r_ft * FT) > 0.02 * r_ft * FT else 'centre off the axis' if abs(across) > 0.3 else ''
        log(f'  {name}: radius {R:.2f} m (rule {r_ft * FT:.2f}), edge on {share:.0%} of rays; centre {along:.2f} m out '
            f'(rule {out_ft * FT:.2f}), {across:+.2f} m off the axis' + (f' - not used: {bad}' if bad else ''))
        if not bad: est[name] = along - out_ft * FT
    if by_chalk:
        for name, v in est.items(): log(f'  {name} puts home {v:+.2f} m along the axis from the chalk')
        if any(abs(v) > 0.5 for v in est.values()): raise SystemExit('a rule feature disagrees with the chalk by more than 0.5 m')
        return hx, hy
    if len(est) < 2: raise SystemExit('no chalk and fewer than two rule features: home not placed')
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
        log(f'  chalk on {l1[2]}/{l2[2]} of 121 sections, lines {spread:.2f} deg apart')
        by_chalk = min(l1[2], l2[2]) >= 30 and abs(spread - 90) < 0.5
    if not by_chalk:
        l1, l2 = base_path(m, hx, hy, lf), base_path(m, hx, hy, rf)
        if not (l1 and l2): raise SystemExit('neither chalk nor base paths found')
        spread = (math.degrees(math.atan2(l2[1][1], l2[1][0])) - math.degrees(math.atan2(l1[1][1], l1[1][0]))) % 360
        log(f'  base paths {spread:.2f} deg apart')
        if abs(spread - 90) > 0.5: raise SystemExit('base paths not square')
    axis = math.degrees(math.atan2(l1[1][1], l1[1][0])) + spread / 2
    hx, hy = register(m, *cross(l1, l2), axis, by_chalk, log)
    return hx, hy, axis, 'chalk' if by_chalk else 'mound and infield arc'

# ---- wall ----

def kind(c):
    """G grass, T warning track, O anything else. The track stays redder than green and bluer than green from full sun
    (123,79,86) into the shade of a tall wall (63,58,72); padded faces (navy 43,43,59, teal 66,87,99) and caps
    (98,113,119) are not redder than green; brick behind a wall (144,108,103) is red but not bluer than green."""
    r, g, b = c
    if r - g < -3 and g >= b - 4: return 'G'
    if r - g > 3 and b >= g - 2: return 'T'
    return 'O'

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

def trace(m, hx, hy, axis):
    rays = {k / 2: wall(m, hx, hy, axis, k / 2) for k in range(-90, 91)}
    rays = {a: v for a, v in rays.items() if v}
    keep = {}
    for a, v in rays.items():
        near = sorted(w for b, w in rays.items() if b != a and abs(b - a) <= 2)
        if near and abs(v - near[len(near) // 2]) <= 2: keep[a] = v
    return keep

def pole(rays, side):
    """the wall's distance along a foul line: the line through the rays within 3 degrees of it, carried out to it"""
    near = [(a, r) for a, r in rays.items() if 42 <= side * a <= 45]
    if len(near) < 3: return None
    c, d = tls([(r * math.sin(math.radians(a)), r * math.cos(math.radians(a))) for a, r in near])
    ux, uy = math.sin(math.radians(45 * side)), math.cos(math.radians(45 * side))
    return (c[0] * d[1] - c[1] * d[0]) / (ux * d[1] - uy * d[0])

def profile(rays):
    p = []
    for i in range(91):
        near = sorted(v for a, v in rays.items() if abs(a - (i - 45)) <= 0.5)
        p.append(near[len(near) // 2] if near else None)
    p[0], p[90] = pole(rays, -1), pole(rays, 1)
    i = 0
    while i < 91:
        if p[i] is None:
            j = i
            while j < 91 and p[j] is None: j += 1
            if i == 0 or j == 91 or j - i > 3: raise SystemExit(f'wall not found from {i - 45} to {j - 46} deg')
            for k in range(i, j): p[k] = p[i - 1] + (p[j] - p[i - 1]) * (k - i + 1) / (j - i + 1)
            i = j
        else: i += 1
    return [round(v, 1) for v in p]

def overlay(m, hx, hy, axis, rays, p, path):
    im = m.raw.copy(); d = ImageDraw.Draw(im)
    pt = lambda a, r: (hx + math.cos(math.radians(axis + a)) * r / m.mpp, hy + math.sin(math.radians(axis + a)) * r / m.mpp)
    for s in (-45, 45): d.line([(hx, hy), pt(s, 100)], fill=(255, 0, 255), width=2)
    d.line([pt(i - 45, v) for i, v in enumerate(p)], fill=(255, 230, 0), width=2)
    for a, v in rays.items(): x, y = pt(a, v); d.ellipse([x - 3, y - 3, x + 3, y + 3], outline=(0, 255, 255))
    R = 140 / m.mpp; im.crop((int(hx - R), int(hy - R), int(hx + R), int(hy + R))).resize((1400, 1400)).save(path)

def measure(name):
    park = PARKS[name]; log = print
    year = park['savant']
    meas, rec = measured(year)[name], rows(year)[name]
    runs = []
    for src in park['sources']:
        m = Photo(photo(name, src)); log(f"{name}, {src['year']} photo:")
        hx, hy, axis, how = home_plate(m, park, log)
        rays = trace(m, hx, hy, axis)
        log(f'  wall traced on {len(rays)}/181 rays')
        runs.append((src, m, hx, hy, axis, how, rays))
    src, m, hx, hy, axis, how, rays = runs[0]
    p = profile(rays)
    overlay(m, hx, hy, axis, rays, p, CACHE / f"{park['key']}_{src['year']}.overlay.png")
    at = lambda deg: p[int(deg + 45)] + (p[min(90, int(deg + 45) + 1)] - p[int(deg + 45)]) * (deg + 45 - int(deg + 45))
    checks = {lab: (round(at(deg), 1), round(v, 1)) for lab, deg, v in zip(('LF', 'LCF', 'CF', 'RCF', 'RF'), (-45, -17.5, 0, 17.5, 45), meas)}
    checks['deepest'] = (max(p), round(rec['distance_deepest'] * FT, 1))
    area = sum((p[i] ** 2 + p[i + 1] ** 2) / 4 * math.radians(1) for i in range(90)); savant_area = rec['fence_area'] * FT * FT
    log(f"  vs Savant {year} (m): " + '  '.join(f'{k} {a}/{b} ({a - b:+.1f})' for k, (a, b) in checks.items())
        + f'  area {area:.0f}/{savant_area:.0f} m2 ({area / savant_area - 1:+.1%})')
    ok = all(abs(a - b) <= 1.5 for a, b in checks.values()) and abs(area / savant_area - 1) <= 0.02
    for other in runs[1:]:
        both = sorted(set(rays) & set(other[6])); diff = sorted(abs(other[6][a] - rays[a]) for a in both)
        med = diff[len(diff) // 2] if diff else None
        log(f"  {other[0]['year']} photo: {len(both)} rays traced in both, median difference {med:.2f} m" if diff else '  no rays in common')
        ok = ok and len(both) >= 60 and med <= 0.5
    if not ok: raise SystemExit(f'{name}: checks failed, not written')
    data = json.loads(OUT.read_text()) if OUT.exists() else {'profiles': {}, 'sources': {}}
    data['profiles'][name] = p
    data['sources'][name] = {'photo': f"{src['service']} ({src['flown']})", 'licence': src['licence'], 'home plate': how,
                             'checked against': [f"{o[0]['service']} ({o[0]['flown']})" for o in runs[1:]] + [f'Baseball Savant {year}']}
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1) + '\n')
    log(f'{name}: written to {OUT.name}')

if __name__ == '__main__':
    cmd, name = sys.argv[1], sys.argv[2]
    {'fetch': fetch, 'measure': measure}[cmd](name)
