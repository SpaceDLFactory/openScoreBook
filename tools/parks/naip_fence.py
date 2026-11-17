"""Measure MLB walls the traced outlines no longer fit, on USDA NAIP aerial imagery (public domain, via USGS).

For the open-air parks that changed since GeomMLBStadiums was traced, this runs the KBO tool's measurement
(tools/park_fence: home plate from the chalk foul lines, the wall as the outer edge of the warning track) on a NAIP
image instead of VWorld tiles, and models the wall as straight segments between corners (the trace's RDP corners at
1 m; MLB walls are mostly straight runs, and this fit the trace to 0.3 m where one polynomial left 1.2 m).

A park is kept only if, before anything is fitted to it, the walls at the gaps (17.5 degrees off center) and in
center come within 2 m of Baseball Savant's measured points and the poles within 4 m (the traces run about 3 m
long at both poles), and two checks the fit never sees agree within 1.5 m: Savant's deepest point, and the posted
gap distances at 22.5 degrees. Then its corners are moved until the walls pass through Savant's points. Tried on
2026-11-17 for seven parks: only Angel Stadium passes; the rest are lost to stands' shadows on the wall (Comerica,
Busch), imagery older than the 2026 fences (Kauffman), leaning stands (Dodger Stadium), Camden Yards' left field and
Fenway's right-field corner. Domed parks show no wall from above.

    python3 naip_fence.py fetch            # images -> fixtures/parks/naip/ (gitignored)
    python3 naip_fence.py measure [PARK]   # home plate, wall trace, raw profile; writes PARK overlay for checking
    python3 naip_fence.py profiles         # check against Savant, write naip_profiles.json (numbers only)
"""
import json, math, sys, time, urllib.parse, urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'park_fence'))
import park_fence as pf  # noqa: E402
from mlb_outlines import DIMS, FT, get, measured  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402

HERE = Path(__file__).resolve().parent
CACHE = Path(__file__).resolve().parents[2] / 'fixtures' / 'parks' / 'naip'
PARKS = json.loads((HERE / 'naip_parks.json').read_text())
HALF, N = 170, 1200  # meters each side of the venue's coordinate, pixels across
NAIP = 'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage?'

def image_path(name): return CACHE / (PARKS[name]['key'] + '.jpg')

def fetch(name):
    lat, lon = PARKS[name]['center']
    R = 6378137.0
    x = math.radians(lon) * R; y = math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * R
    h = HALF / math.cos(math.radians(lat))  # Web Mercator stretches by 1/cos(lat)
    q = urllib.parse.urlencode({'bbox': f'{x - h},{y - h},{x + h},{y + h}', 'bboxSR': 3857, 'imageSR': 3857, 'size': f'{N},{N}', 'format': 'jpg', 'f': 'image'})
    for attempt in range(5):
        try:
            b = urllib.request.urlopen(urllib.request.Request(NAIP + q, headers={'User-Agent': 'openScoreBook park outline measurement'}), timeout=180).read()
            break
        except Exception as e:  # the service times out now and then
            print(name, 'retry', attempt, e, file=sys.stderr); time.sleep(15)
    else:
        raise SystemExit(f'{name}: no image')
    CACHE.mkdir(parents=True, exist_ok=True)
    image_path(name).write_bytes(b)
    print(name, image_path(name).name, len(b), file=sys.stderr)

class Naip(pf.Mosaic):
    """park_fence's Mosaic over one NAIP image (north up, square ground pixels)"""
    def __init__(self, name):
        self.im = Image.open(image_path(name)).convert('RGB')
        self.W, self.H = self.im.size
        self.px = self.im.load()
        self.mpp = 2 * HALF / N
        self.white = [0.0] * (self.W * self.H)
        for yy in range(self.H):
            for xx in range(self.W):
                r, g, b = self.px[xx, yy]
                self.white[yy * self.W + xx] = min(r, g, b) - 0.5 * (max(r, g, b) - min(r, g, b))

def measure(name):
    cfg = PARKS[name]; m = Naip(name)
    # the guess: home plate pixel, and the bearing to center field in image degrees (azimuth from north - 90)
    hx0, hy0 = cfg['home']; cf0 = cfg['azimuth'] - 90
    (hx, hy), cf, between = pf.foul_lines(m, hx0, hy0, cf0, *cfg.get('search', (12, 10)))
    pts = pf.trace(m, hx, hy, cf)
    out = {'park': name, 'mpp': m.mpp, 'home': [hx, hy], 'cf': cf, 'foul_line_angle': between,
           'trace': {str(a / 2): v for a, v in sorted(pts.items())}, 'raw': pf.raw_profile(pts, m.mpp, hx, hy, cf)}
    (CACHE / f"{cfg['key']}.measure.json").write_text(json.dumps(out))
    ov = m.im.copy(); d = ImageDraw.Draw(ov)
    for s in (-45, 45): d.line([(hx, hy), (hx + pf.u(cf + s)[0] * 140 / m.mpp, hy + pf.u(cf + s)[1] * 140 / m.mpp)], fill=(255, 0, 255), width=2)
    for a, v in pts.items():
        x, y = hx + pf.u(cf + a / 2)[0] * v / m.mpp, hy + pf.u(cf + a / 2)[1] * v / m.mpp
        d.ellipse([x - 3, y - 3, x + 3, y + 3], fill=(255, 0, 0))
    ov.save(CACHE / f"{cfg['key']}.overlay.png")
    raw = out['raw']
    print(f"{name}: home {hx:.0f},{hy:.0f} cf {cf:.1f} foul lines {between:.1f} deg  raw LF/CF/RF {raw[0]}/{raw[45]}/{raw[90]}")

ANCHORS = (-45, -17.5, 0, 17.5, 45)

def profiles(year):
    import re
    meas, rows = {}, {}
    for y in (year, year - 1):
        try:
            meas = measured(y)
            rows = {r['venue_name_short']: r for r in json.loads(re.search(r'var data\s*=\s*(\[.*?\]);\s*\n', get(DIMS.format(year=y)), re.S).group(1))}
            break
        except Exception as e: print('no Savant dimensions for', y, e)
    # the published distances (not labels read off a profile this script made earlier)
    posted = {p['name']: p.get('posted', p['f']) for p in json.loads((HERE.parents[1] / 'app/src/lib/parks.json').read_text())['parks']}
    out = {}
    for name, cfg in PARKS.items():
        f = CACHE / f"{cfg['key']}.measure.json"
        if not f.exists() or name not in meas: continue
        raw = pf.bridge(json.loads(f.read_text())['raw'])
        pts = [(r * math.sin(math.radians(i - 45)), r * math.cos(math.radians(i - 45))) for i, r in enumerate(raw)]
        verts = [k - 45 for k in pf.rdp(pts, cfg.get('tol', 1.0))]
        radii = [raw[v + 45] for v in verts]
        poly = pf.polygon(verts, radii)
        m = meas[name]
        resid = [pf.at(poly, a) - mm for a, mm in zip(ANCHORS, m)]
        deep = rows[name]['distance_deepest'] * FT
        signs = [abs(pf.at(poly, a) - posted[name][i]) for a, i in ((-22.5, 1), (22.5, 3)) if posted[name][i] is not None]
        checks = {'shape': max(abs(x) for x in resid[1:4]) <= 2 and max(abs(resid[0]), abs(resid[4])) <= 4,
                  'deepest': abs(max(poly) - deep) <= 1.5, 'posted gaps': all(s <= 1.5 for s in signs)}
        print(f"{name}: before fitting {[round(x, 1) for x in resid]}, deepest {max(poly):.1f}/{deep:.1f}, posted gaps off {[round(s, 1) for s in signs]} -> "
              + ('kept' if all(checks.values()) else 'dropped (' + ', '.join(k for k, v in checks.items() if not v) + ')'))
        if not all(checks.values()): continue
        for _ in range(40):  # move the corners until the walls pass through Savant's points
            cur = pf.polygon(verts, radii)
            res = sorted((a, mm - pf.at(cur, a)) for a, mm in zip(ANCHORS, m))
            if max(abs(r) for _, r in res) < 0.02: break
            radii = [r + pf.piecewise(res)(v) for v, r in zip(verts, radii)]
        out[name] = [round(x, 1) for x in pf.polygon(verts, radii)]
    (HERE / 'naip_profiles.json').write_text(json.dumps({'source': 'USDA NAIP aerial imagery via USGS (public domain), measured with tools/park_fence, shifted onto Baseball Savant park dimensions',
                                                         'profiles': out}, separators=(',', ':')) + '\n')
    print('kept', list(out))

if __name__ == '__main__':
    cmd, names = sys.argv[1], sys.argv[2:] or list(PARKS)
    if cmd == 'fetch': [fetch(n) for n in names if not image_path(n).exists()]
    elif cmd == 'measure': [measure(n) for n in names]
    elif cmd == 'profiles': profiles(int(sys.argv[2]) if len(sys.argv) > 2 else 2026)
