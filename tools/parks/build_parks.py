"""Fence distances of MLB, minor league and NPB parks for the app (app/src/lib/parks.json).

MLB and the minors (Triple-A, Double-A, High-A, Single-A): the MLB Stats API's venue field info (feet, at the left
field line, left-center, center, right-center, right field line), one venue per park, under the highest level that
plays there. NPB: the twelve home parks, from each park's Japanese Wikipedia article (the official figures it quotes;
checked 2026-11-17). Distances that look wrong (outside 250-470 ft, or a gap not between line and center) are dropped
and left for the app to estimate.

MLB parks whose outline traced in GeomMLBStadiums still matches Baseball Savant's measured wall get a 1-degree
profile too (mlb_outlines.py), and so do those measured on NAIP aerial imagery that pass the same kind of check
(naip_fence.py -> naip_profiles.json); their five labels are then read off that profile.

    python3 build_parks.py 2026
"""
import json, sys, urllib.request
from mlb_outlines import outlines
from datetime import date
from pathlib import Path

OUT = Path(__file__).resolve().parents[2] / 'app/src/lib/parks.json'
HERE_NAIP = Path(__file__).resolve().parent / 'naip_profiles.json'
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
    gap = lambda g, line: g if ok(g) and min(line, cf) - 5 <= g <= cf + 10 else None
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
    # measured walls (the latest season Savant has) with outlines that still fit them
    for year in (int(season), int(season) - 1):
        try: prof, report = outlines(year); break
        except Exception as e: print('no Savant dimensions for', year, e)
    print('outline check (worst miss, m):', report)
    naip = HERE_NAIP.exists() and json.loads(HERE_NAIP.read_text())['profiles'] or {}
    prof = {**naip, **prof}  # a traced outline that fits wins over an aerial measurement
    for p in parks:
        q = prof.get(p['name']) if p['league'] == 'MLB' else None
        if not q: continue
        p['p'] = q
        p['posted'] = p['f']  # the published distances, kept for checking measurements against
        p['f'] = [q[0], round((q[22] + q[23]) / 2, 1), q[45], round((q[67] + q[68]) / 2, 1), q[90]]
        p['src'] = ['ok', 'sat', 'ok', 'sat', 'ok']  # lines and center measured; gaps read off the outline
    OUT.write_text(json.dumps({'source': f'MLB Stats API venue fieldInfo, season {season}; NPB: Japanese Wikipedia park articles; '
                                         f'MLB outlines: GeomMLBStadiums (MIT, (c) 2018 Ben Dilday) or USDA NAIP imagery (public domain), fitted to Baseball Savant park dimensions',
                               'fetched': str(date.today()),
                               'parks': parks}, ensure_ascii=False, separators=(',', ':')) + '\n')
    from collections import Counter
    print('wrote', OUT, len(parks), dict(Counter(p['league'] for p in parks)), 'with outlines:', sum('p' in p for p in parks))

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else str(date.today().year))
