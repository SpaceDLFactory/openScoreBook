"""Fence distances of MLB, minor league and NPB parks for the app (app/src/lib/parks.json).

MLB and the minors (Triple-A, Double-A, High-A, Single-A): the MLB Stats API's venue field info (feet, at the left
field line, left-center, center, right-center, right field line), one venue per park, under the highest level that
plays there. NPB: the twelve home parks, from each park's Japanese Wikipedia article (the official figures it quotes;
checked 2026-11-17). Distances that look wrong (outside 250-470 ft, or a gap not between line and center) are dropped
and left for the app to estimate.

MLB parks take Baseball Savant's Statcast-measured lines and straightaway center (savant.py) over the posted
distances. A park whose wall has been measured on aerial imagery and checked (ortho_fence.py -> ortho_profiles.json
on 0.1 m city orthophotos, else naip_fence.py -> naip_profiles.json) gets that 1-degree profile, its labels read off
it; no other MLB outline is drawn, since none has been validated.
(An outline traced around 2018 in GeomMLBStadiums was tried and dropped: scaled and nudged onto five points, it was
a sketch, not a measured wall.)

    python3 build_parks.py 2026
"""
import json, sys, urllib.request
from savant import measured
from datetime import date
from pathlib import Path

OUT = Path(__file__).resolve().parents[2] / 'app/src/lib/parks.json'
HERE_NAIP = Path(__file__).resolve().parent / 'naip_profiles.json'
HERE_ORTHO = Path(__file__).resolve().parent / 'ortho_profiles.json'
LEVEL = {1: 'MLB', 11: 'AAA', 12: 'AA', 13: 'A+', 14: 'A'}
FT = 0.3048

# NPB home parks (m): LF line, LCF, CF, RCF, RF; None = not published
NPB = [
    ('도쿄돔', '요미우리', [100, 110, 122, 110, 100]),
    ('한신 고시엔 구장', '한신', [95, 118, 118, 118, 95]),
    ('반테린 돔 나고야', '주니치', [100, 110, 122, 110, 100]),
    ('마쓰다 스타디움', '히로시마', [101, 116, 122, 116, 100]),
    ('메이지 진구 구장', '야쿠르트', [97.5, 112.3, 120, 112.3, 97.5]),
    ('요코하마 스타디움', 'DeNA', [94.2, 111.4, 117.7, 111.4, 94.2]),
    ('미즈호 PayPay 돔 후쿠오카', '소프트뱅크', [100, 110, 122, 110, 100]),
    ('에스콘 필드 홋카이도', '닛폰햄', [97, None, 121, None, 99]),
    ('ZOZO 마린 스타디움', '롯데', [99.5, 112.3, 122, 112.3, 99.5]),
    ('라쿠텐 모바일 파크 미야기', '라쿠텐', [100.1, 110, 122, 112, 100.1]),
    ('베루나 돔', '세이부', [100, 116, 122, 116, 100]),
    ('교세라 돔 오사카', '오릭스', [100, 116, 122, 116, 100]),
]

def sane(ft):
    """five distances in feet -> meters, None where missing or implausible"""
    ok = lambda v: isinstance(v, (int, float)) and 250 <= v <= 470
    lf, lcf, cf, rcf, rf = ft
    if not (ok(lf) and ok(cf) and ok(rf)): return None
    # a gap may well be deeper than center (Oracle's 415 ft alley against 391 ft center, PNC's 410 ft corner)
    gap = lambda g, line: g if ok(g) and min(line, cf) - 5 <= g <= cf + 30 else None
    return [round(v * FT, 1) if v is not None else None for v in (lf, gap(lcf, lf), cf, gap(rcf, rf), rf)]

def main(season):
    url = f'https://statsapi.mlb.com/api/v1/teams?sportIds=1,11,12,13,14&season={season}&hydrate=venue(fieldInfo,location)'
    teams = json.load(urllib.request.urlopen(url, timeout=60))['teams']
    venues = {}
    for t in sorted(teams, key=lambda t: list(LEVEL).index(t['sport']['id'])):
        v = t['venue']; fi = v.get('fieldInfo') or {}
        f = sane([fi.get('leftLine'), fi.get('leftCenter'), fi.get('center'), fi.get('rightCenter'), fi.get('rightLine')])
        if not f: print('skip', v['name'], fi); continue
        if v['id'] in venues: venues[v['id']]['teams'].append(t['name']); continue
        venues[v['id']] = {'name': v['name'], 'league': LEVEL[t['sport']['id']], 'teams': [t['name']], 'f': f}
    parks = [{'name': n, 'league': 'NPB', 'teams': [team], 'f': f} for n, team, f in NPB] + list(venues.values())
    seen = {}
    for p in parks:  # one name, one park
        if p['name'] in seen: p['name'] = f"{p['name']} ({p['teams'][0]})"
        seen[p['name']] = p
    for p in parks: p['src'] = ['est' if v is None else 'ok' for v in p['f']]
    # Savant's measurements for the latest season it has
    meas = {}
    for year in (int(season), int(season) - 1):
        try: meas = measured(year); break
        except Exception as e: print('no Savant dimensions for', year, e)
    prof = HERE_NAIP.exists() and json.loads(HERE_NAIP.read_text())['profiles'] or {}
    ortho = json.loads(HERE_ORTHO.read_text()) if HERE_ORTHO.exists() else {'profiles': {}, 'sources': {}}
    prof.update(ortho['profiles'])  # the finer photos win
    for p in parks:
        q = prof.get(p['name']) if p['league'] == 'MLB' else None
        if not q: continue
        p['p'] = q
        p['posted'] = p['f']  # the published distances, kept for checking measurements against
        p['f'] = [q[0], round((q[22] + q[23]) / 2, 1), q[45], round((q[67] + q[68]) / 2, 1), q[90]]
        p['src'] = ['ok', 'sat', 'ok', 'sat', 'ok']  # read off the measured outline
    # MLB parks without an outline: Savant's measured lines and straightaway center replace the posted ones (a
    # posted "center" can be the deepest corner: Fenway's 420 ft triangle, not 0 degrees); posted gaps are signs at
    # unknown bearings, kept as estimates
    for p in parks:
        if p['league'] == 'MLB' and p['name'] not in prof and p['name'] in meas:
            m = meas[p['name']]
            p['posted'] = p['f']
            p['f'] = [round(m[0], 1), p['f'][1], round(m[2], 1), p['f'][3], round(m[4], 1)]
            p['src'] = ['ok', 'est', 'ok', 'est', 'ok']
    OUT.write_text(json.dumps({'source': f'MLB Stats API venue fieldInfo, season {season}; NPB: Japanese Wikipedia park articles; '
                                         f'MLB: Baseball Savant measured distances; outlines measured on USDA NAIP imagery (public domain)'
                                         + ''.join(f'; {n} outline measured on orthophotos ({ortho["sources"][n]["licence"]})' for n in sorted(ortho['sources'])),
                               'fetched': str(date.today()),
                               'parks': parks}, ensure_ascii=False, separators=(',', ':')) + '\n')
    from collections import Counter
    print('wrote', OUT, len(parks), dict(Counter(p['league'] for p in parks)), 'with outlines:', [p['name'] for p in parks if 'p' in p])

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else str(date.today().year))
