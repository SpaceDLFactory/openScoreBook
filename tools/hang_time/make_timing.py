"""Build a local page for timing hang times on real MLB video, to check what model.py assumes.

Picks air balls from the Statcast CSVs in data/ and writes out/timing.html, which shows each play's clip through
Baseball Savant's own video page beside a stopwatch: press at contact and at the landing or catch, as one would while
scoring a game live. Once enough are timed the page compares your times with the model's and estimates exit velocity
and launch angle from (Statcast distance, your hang time), against the truth; those stay hidden until then. Nothing
from Statcast or MLB goes into git (out/ and data/ are ignored).

    .venv/bin/python make_timing.py data 30
"""
import csv, glob, json, sys, time, urllib.request
from pathlib import Path
import numpy as np
from model import FT, fly, load
from scipy.optimize import minimize

HERE = Path(__file__).parent
UA = {'User-Agent': 'Mozilla/5.0'}
CATCH_Z = 1.8  # m, about where an outfielder catches it

def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
        return r.read()

def fly_to(ev, la, rho, p, z_end):
    """distance and time when the ball comes down to z_end (descending)"""
    from model import MPH, R, A, M, G
    cd, s0, s1 = p
    v = np.asarray(ev, float) * MPH; a = np.radians(np.asarray(la, float)); rhov = 1.2 * np.asarray(rho, float)
    omega = np.clip(s0 + s1 * np.degrees(a), 300, 4500) * 2 * np.pi / 60
    x = np.zeros_like(v); z = np.full_like(v, 0.9); vx = v * np.cos(a); vz = v * np.sin(a)
    k = 0.5 * rhov * A / M; dt = 0.005; t = 0.0
    d_out = np.full_like(v, np.nan); t_out = np.full_like(v, np.nan); alive = np.ones_like(v, bool)
    for _ in range(3000):
        sp = np.hypot(vx, vz); S = R * omega / np.maximum(sp, 1e-6); cl = S / (0.4 + 2.32 * S)
        ax = -k * cd * sp * vx - k * cl * sp * vz; az = -G - k * cd * sp * vz + k * cl * sp * vx
        nx, nz, nvx, nvz = x + vx * dt, z + vz * dt, vx + ax * dt, vz + az * dt
        hit = alive & (nz <= z_end) & (vz < 0) & (z > z_end)
        if hit.any():
            f = (z[hit] - z_end) / (z[hit] - nz[hit])
            d_out[hit] = x[hit] + f * (nx[hit] - x[hit]); t_out[hit] = t + f * dt; alive &= ~hit
        x, z, vx, vz = nx, nz, nvx, nvz; t += dt
        if not alive.any(): break
    return d_out, t_out

def main():
    data, n = sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 30
    files = sorted(glob.glob(f'{data}/*.csv'))
    rows = load(files)
    # same calibration as model.py
    tr = np.array([r[:4] for r in rows])
    loss = lambda p: np.nanmean(np.abs(fly(tr[:, 0], tr[:, 1], tr[:, 3], p)[0] - tr[:, 2]))
    p = minimize(loss, [0.33, 1000, 40], method='Nelder-Mead', options={'maxiter': 200, 'xatol': 1e-3, 'fatol': 0.01}).x
    print('model', p)

    # candidates with what's needed to find the clip; sea-level parks only
    cand = []
    for f in files:
        for r in csv.DictReader(open(f, encoding='utf-8-sig')):
            if r['bb_type'] not in ('fly_ball', 'line_drive') or r['home_team'] == 'COL' or not r['hit_distance_sc'] or not r['launch_speed']:
                continue
            ev, la, d = float(r['launch_speed']), float(r['launch_angle']), float(r['hit_distance_sc']) * FT
            if 10 <= la <= 55 and d >= 60 and r['events'] != 'home_run':  # stays in the park, so it lands or is caught in view
                cand.append({'game_pk': r['game_pk'], 'ab': int(r['at_bat_number']), 'pitch': int(r['pitch_number']), 'ev': ev, 'la': la, 'd': d,
                             'caught': r['events'] in ('field_out', 'sac_fly', 'double_play', 'sac_fly_double_play'), 'des': r['des']})
    rng = np.random.default_rng(11)
    # spread over launch angle: line drives, flies, high flies
    bands = [[c for c in cand if lo <= c['la'] < hi] for lo, hi in [(10, 20), (20, 32), (32, 56)]]
    pick = [c for b in bands for c in rng.permutation(np.array(b, dtype=object))[: n // 3 + 2]]
    feeds, plays = {}, []
    for c in pick:
        if len(plays) >= n: break
        if c['game_pk'] not in feeds:
            feeds[c['game_pk']] = json.loads(get(f"https://baseballsavant.mlb.com/gf?game_pk={c['game_pk']}")); time.sleep(1)
        fd = feeds[c['game_pk']]
        hit = [x for side in ('team_home', 'team_away') for x in fd.get(side, []) if x.get('ab_number') == c['ab'] and x.get('pitch_number') == c['pitch']]
        if not hit: continue
        z_end = CATCH_Z if c['caught'] else 0.0
        _, tm = fly_to([c['ev']], [c['la']], [1.0], p, z_end)
        plays.append({**{k: c[k] for k in ('ev', 'la', 'd', 'caught', 'des')}, 'video': f"https://baseballsavant.mlb.com/sporty-videos?playId={hit[0]['play_id']}", 't_model': round(float(tm[0]), 2)})
        print(len(plays), c['la'], c['des'][:60])

    # inversion grids: (distance to the ground, time to the ground) and (distance to the ground, time to a catch)
    EVg, LAg = np.meshgrid(np.arange(55, 121, 1.0), np.arange(6, 62, 0.5))
    ev, la = EVg.ravel(), LAg.ravel()
    # one integrator for the grid and the plays' model times, so they compare like for like
    gd, gt0 = fly_to(ev, la, np.ones(ev.size), p, 0.0)
    _, gtc = fly_to(ev, la, np.ones(ev.size), p, CATCH_Z)
    ok = ~(np.isnan(gd) | np.isnan(gt0) | np.isnan(gtc))
    grid = {'ev': ev[ok].tolist(), 'la': la[ok].tolist(), 'd': np.round(gd[ok], 1).tolist(), 't0': np.round(gt0[ok], 3).tolist(), 'tc': np.round(gtc[ok], 3).tolist()}
    # distance-only baseline from all the balls: mean EV and LA of balls landing within 4 m
    allb = np.array([r[:3] for r in rows if r[3] == 1.0])
    for q in plays:
        near = np.abs(allb[:, 2] - q['d']) <= 4
        q['ev_dist'], q['la_dist'] = round(float(allb[near, 0].mean()), 1), round(float(allb[near, 1].mean()), 1)
    out = HERE / 'out'; out.mkdir(exist_ok=True)
    html = (HERE / 'timing.template.html').read_text().replace('/*DATA*/null', json.dumps({'plays': plays, 'grid': grid}))
    (out / 'timing.html').write_text(html)
    print('wrote', out / 'timing.html', len(plays), 'plays')

if __name__ == '__main__':
    main()
