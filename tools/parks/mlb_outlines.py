"""1-degree wall profiles for MLB parks whose traced outline still matches today's measured wall.

Outlines: GeomMLBStadiums (Ben Dilday, MIT; see LICENSE-GeomMLBStadiums), MLBAM hit-coordinate paths of each park's
outer outfield edge, traced around 2018. Measurements: Baseball Savant's park dimensions (Statcast-measured distance
at the lines, the gaps and center field, for the season asked for).

Per park: home plate from the home plate path, the center axis halfway between the foul lines; the outline's
distance on every degree from -45 to +45; one scale per park fitted at the lines and center (the paths run about 3%
large); then the outline is kept only if it is within 2 m of every measured point (Savant's gap points sit near
17.5 degrees off center, not 22.5), and nudged to meet them exactly. Parks rebuilt or re-fenced since the tracing
(Camden Yards, Rogers Centre, Kauffman, ...) fail the test and keep their five published distances.

For those, naip_fence.py measures the open-air ones on USDA NAIP aerial imagery; of seven tried, Angel Stadium
passes its checks (see there).
"""
import csv, io, json, math, re, statistics, urllib.request
from collections import defaultdict

PATHS = 'https://raw.githubusercontent.com/bdilday/GeomMLBStadiums/master/inst/extdata/mlb_stadia_paths.csv'
DIMS = 'https://baseballsavant.mlb.com/leaderboard/statcast-park-factors?type=dimensions&year={year}&batSide=&stat=index_wOBA&condition=All&rolling=3&parks=mlb&fenceStatType=distance'
SCALE, FT = 2.495671, 0.3048  # MLBAM hit coordinates to feet (GeomMLBStadiums), feet to meters
ANCHORS = (-45, -17.5, 0, 17.5, 45)
TOL = 2.0
# the package's team keys and the venue each team plays in now (athletics: traced at the Coliseum, now gone)
TEAM_VENUE = {
    'angels': 'Angel Stadium', 'astros': 'Daikin Park', 'blue_jays': 'Rogers Centre', 'braves': 'Truist Park', 'brewers': 'American Family Field',
    'cardinals': 'Busch Stadium', 'cubs': 'Wrigley Field', 'diamondbacks': 'Chase Field', 'dodgers': 'UNIQLO Field at Dodger Stadium', 'giants': 'Oracle Park',
    'guardians': 'Progressive Field', 'mariners': 'T-Mobile Park', 'marlins': 'loanDepot park', 'mets': 'Citi Field', 'nationals': 'Nationals Park',
    'orioles': 'Oriole Park at Camden Yards', 'padres': 'Petco Park', 'phillies': 'Citizens Bank Park', 'pirates': 'PNC Park', 'rangers': 'Globe Life Field',
    'rays': 'Tropicana Field', 'red_sox': 'Fenway Park', 'reds': 'Great American Ball Park', 'rockies': 'Coors Field', 'royals': 'Kauffman Stadium',
    'tigers': 'Comerica Park', 'twins': 'Target Field', 'white_sox': 'Rate Field', 'yankees': 'Yankee Stadium',
}

def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=60).read().decode('utf-8', 'replace')

def measured(year):
    html = get(DIMS.format(year=year))
    rows = json.loads(re.search(r'var data\s*=\s*(\[.*?\]);\s*\n', html, re.S).group(1))
    keys = ('distance_lf_line', 'distance_lf_gap', 'distance_cf', 'distance_rf_gap', 'distance_rf_line')
    return {r['venue_name_short']: [r[k] * FT for k in keys] for r in rows}

def profile(seg):
    """wall distance (path units) on each degree -45..45 from home plate, about the axis between the foul lines"""
    hp = seg['home_plate']; hx = sum(p[0] for p in hp) / len(hp); hy = sum(p[1] for p in hp) / len(hp)
    far = sorted(seg['foul_lines'], key=lambda p: -math.hypot(p[0] - hx, p[1] - hy))
    a = far[0]; b = next(p for p in far if math.hypot(p[0] - a[0], p[1] - a[1]) > 50)
    ang = lambda p: math.atan2(p[0] - hx, hy - p[1])
    axis = (ang(a) + ang(b)) / 2
    wall = seg['outfield_outer']
    out = []
    for deg in range(-45, 46):
        th = axis + math.radians(deg); dx, dy = math.sin(th), -math.cos(th)
        best = None
        for (x1, y1), (x2, y2) in zip(wall, wall[1:]):
            ex, ey = x2 - x1, y2 - y1; den = dx * ey - dy * ex
            if abs(den) < 1e-12: continue
            t = ((x1 - hx) * ey - (y1 - hy) * ex) / den; u = ((x1 - hx) * dy - (y1 - hy) * dx) / den
            if t > 0 and 0 <= u <= 1 and (best is None or t > best): best = t
        out.append(best)
    return out

def at(q, deg):
    u = deg + 45; i = min(89, int(u)); return q[i] + (q[i + 1] - q[i]) * (u - i)

def smooth_onto(q, m, sigma=2.0):
    """Gaussian smoothing along the wall (sigma in degrees, mirrored at the poles), then nudged back onto the measured
    points. Takes out the 1-3 degree kinks of tracing and the corners of straight-wall models; 2 degrees keeps a park's
    features (Angel's right-field shelf, PNC's left-center jog), 4 already rounds them off by a couple of meters."""
    h = int(3 * sigma) + 1
    k = [math.exp(-0.5 * (d / sigma) ** 2) for d in range(-h, h + 1)]
    sm = []
    for i in range(91):
        s = w = 0.0
        for j, kk in enumerate(k):
            t = i + j - h
            t = -t if t < 0 else (180 - t if t > 90 else t)
            s += kk * q[t]; w += kk
        sm.append(s / w)
    c = [mm / at(sm, a) for a, mm in zip(ANCHORS, m)]
    def corr(deg):
        for (a0, c0), (a1, c1) in zip(zip(ANCHORS, c), zip(ANCHORS[1:], c[1:])):
            if a0 <= deg <= a1: return c0 + (c1 - c0) * (deg - a0) / (a1 - a0)
        return c[-1]
    return [round(v * corr(i - 45), 1) for i, v in enumerate(sm)]

def outlines(year):
    """{venue name: 91 distances in meters} for the parks whose outline passes"""
    seg = defaultdict(lambda: defaultdict(list))
    for r in csv.DictReader(io.StringIO(get(PATHS))): seg[r['team']][r['segment']].append((float(r['x']), float(r['y'])))
    meas = measured(year)
    out, report = {}, []
    for team, venue in TEAM_VENUE.items():
        if venue not in meas or team not in seg: continue
        raw = profile(seg[team])
        if any(v is None for v in raw): continue
        q = [v * SCALE * FT for v in raw]
        m = meas[venue]
        k = statistics.median([m[0] / q[0], m[2] / q[45], m[4] / q[90]])
        q = [v * k for v in q]
        resid = [at(q, a) - mm for a, mm in zip(ANCHORS, m)]
        worst = max(abs(x) for x in resid)
        report.append((venue, round(worst, 1)))
        if worst > TOL: continue
        # nudge to the measured points: a correction factor drawn linearly between the anchors
        c = [mm / at(q, a) for a, mm in zip(ANCHORS, m)]
        def corr(deg):
            for (a0, c0), (a1, c1) in zip(zip(ANCHORS, c), zip(ANCHORS[1:], c[1:])):
                if a0 <= deg <= a1: return c0 + (c1 - c0) * (deg - a0) / (a1 - a0)
            return c[-1]
        out[venue] = [round(v * corr(d - 45), 1) for d, v in enumerate(q)]
    return out, sorted(report, key=lambda x: x[1]), meas
