"""Baseball Savant's park dimensions: the Statcast-measured wall distance (feet) at each MLB park's left field line,
left-center gap, straightaway center, right-center gap and right field line, its deepest point and fair area."""
import json, re, urllib.request

DIMS = 'https://baseballsavant.mlb.com/leaderboard/statcast-park-factors?type=dimensions&year={year}&batSide=&stat=index_wOBA&condition=All&rolling=3&parks=mlb&fenceStatType=distance'
FT = 0.3048
KEYS = ('distance_lf_line', 'distance_lf_gap', 'distance_cf', 'distance_rf_gap', 'distance_rf_line')

def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=60).read().decode('utf-8', 'replace')

def rows(year):
    """the page's records, one per park, keyed by venue name"""
    html = get(DIMS.format(year=year))
    return {r['venue_name_short']: r for r in json.loads(re.search(r'var data\s*=\s*(\[.*?\]);\s*\n', html, re.S).group(1))}

def measured(year):
    """{venue name: [LF line, LF gap, CF, RF gap, RF line] in meters}"""
    return {name: [r[k] * FT for k in KEYS] for name, r in rows(year).items()}
