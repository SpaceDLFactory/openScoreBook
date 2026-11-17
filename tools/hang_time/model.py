"""Can landing distance + hang time stand in for exit velocity and launch angle?

1. A drag + Magnus trajectory model, calibrated on some days of public Statcast data (EV, LA -> distance), is
   checked on other days.
2. For held-out balls: observed distance = Statcast distance + tap error, hang time = model hang time + stopwatch
   error; invert (distance, hang) -> (EV, LA) on a grid and compare with the truth. Baseline: distance alone.
Statcast data stays in data/ (not redistributed).
"""
import csv, glob, sys
import numpy as np
from scipy.optimize import minimize

MPH, FT = 0.44704, 0.3048
M, R = 0.145, 0.0366
A = np.pi * R * R
G = 9.81

def load(files):
    rows = []
    for f in files:
        for r in csv.DictReader(open(f, encoding='utf-8-sig')):
            if r['bb_type'] not in ('fly_ball', 'line_drive') or not r['hit_distance_sc'] or not r['launch_speed'] or not r['launch_angle']:
                continue
            ev, la, d = float(r['launch_speed']), float(r['launch_angle']), float(r['hit_distance_sc'])
            if la < 8 or la > 60 or d < 150:  # balls that carry to the outfield
                continue
            rows.append((ev, la, d * FT, 0.82 if r['home_team'] == 'COL' else 1.0, r['game_date'], r['game_pk']))
    seen, out = set(), []
    for x in rows:  # files overlap by a day
        k = x[:3] + (x[5],)
        if k not in seen: seen.add(k); out.append(x)
    return out

def fly(ev_mph, la_deg, rho_k, p, dt=0.01, z0=0.9):
    """Integrate many balls at once; returns landing distance (m) and hang time (s)."""
    cd, s0, s1 = p
    v = np.asarray(ev_mph, float) * MPH
    la = np.radians(np.asarray(la_deg, float))
    rho = 1.2 * np.asarray(rho_k, float)
    rpm = np.clip(s0 + s1 * np.degrees(la), 300, 4500)
    omega = rpm * 2 * np.pi / 60
    x = np.zeros_like(v); z = np.full_like(v, z0); vx = v * np.cos(la); vz = v * np.sin(la)
    d_out = np.full_like(v, np.nan); t_out = np.full_like(v, np.nan)
    k = 0.5 * rho * A / M
    def acc(vx, vz):
        sp = np.hypot(vx, vz)
        S = R * omega / np.maximum(sp, 1e-6)
        cl = S / (0.4 + 2.32 * S)
        ax = -k * cd * sp * vx + k * cl * sp * (-vz)
        az = -G - k * cd * sp * vz + k * cl * sp * vx
        return ax, az
    t = 0.0
    alive = np.ones_like(v, bool)
    for _ in range(1500):
        ax1, az1 = acc(vx, vz)
        ax2, az2 = acc(vx + ax1 * dt / 2, vz + az1 * dt / 2)
        ax3, az3 = acc(vx + ax2 * dt / 2, vz + az2 * dt / 2)
        ax4, az4 = acc(vx + ax3 * dt, vz + az3 * dt)
        nx = x + dt * (vx + dt / 6 * (ax1 + ax2 + ax3))
        nz = z + dt * (vz + dt / 6 * (az1 + az2 + az3))
        nvx = vx + dt / 6 * (ax1 + 2 * ax2 + 2 * ax3 + ax4)
        nvz = vz + dt / 6 * (az1 + 2 * az2 + 2 * az3 + az4)
        land = alive & (nz <= 0) & (t > 0.05)
        if land.any():
            f = z[land] / (z[land] - nz[land])
            d_out[land] = x[land] + f * (nx[land] - x[land]); t_out[land] = t + f * dt
            alive &= ~land
        x, z, vx, vz = nx, nz, nvx, nvz
        t += dt
        if not alive.any(): break
    return d_out, t_out

def main():
    files = sorted(glob.glob(sys.argv[1] + '/*.csv'))
    rows = load(files)
    dates = sorted({r[4] for r in rows})
    cut = dates[len(dates) // 2]
    train = np.array([r[:4] for r in rows if r[4] < cut]); test = np.array([r[:4] for r in rows if r[4] >= cut])
    print(f'balls: {len(rows)} over {dates[0]}..{dates[-1]}; train {len(train)} (<{cut}), test {len(test)}')

    def loss(p):
        d, _ = fly(train[:, 0], train[:, 1], train[:, 3], p)
        return np.nanmean(np.abs(d - train[:, 2]))
    best = minimize(loss, [0.33, 1000, 40], method='Nelder-Mead', options={'maxiter': 200, 'xatol': 1e-3, 'fatol': 0.01})
    p = best.x
    print(f'calibrated: Cd={p[0]:.3f}, spin rpm = {p[1]:.0f} + {p[2]:.1f}*LA; train MAE {best.fun:.2f} m')
    d, t = fly(test[:, 0], test[:, 1], test[:, 3], p)
    err = d - test[:, 2]
    print(f'test distance from EV+LA: MAE {np.nanmean(np.abs(err)):.2f} m, RMSE {np.sqrt(np.nanmean(err**2)):.2f} m, bias {np.nanmean(err):+.2f} m')
    print(f'hang time of test balls (model): median {np.nanmedian(t):.2f} s, 5-95% {np.nanpercentile(t,5):.2f}-{np.nanpercentile(t,95):.2f} s')

    # inversion grid (sea-level air; Coors balls left out of the inversion test)
    EVg, LAg = np.meshgrid(np.arange(55, 121, 0.5), np.arange(6, 62, 0.5))
    gd, gt = fly(EVg.ravel(), LAg.ravel(), np.ones(EVg.size), p)
    ok = ~np.isnan(gd)
    gev, gla, gd, gt = EVg.ravel()[ok], LAg.ravel()[ok], gd[ok], gt[ok]
    sea = test[test[:, 3] == 1.0]
    true_t = fly(sea[:, 0], sea[:, 1], sea[:, 3], p)[1]
    keep = ~np.isnan(true_t); sea, true_t = sea[keep], true_t[keep]
    rng = np.random.default_rng(7)

    # baseline: distance only -> mean EV and LA of training balls with similar distance
    tr_sea = train[train[:, 3] == 1.0]
    def from_distance(dobs):
        ev, la = [], []
        for x in dobs:
            near = np.abs(tr_sea[:, 2] - x) <= 4
            ev.append(tr_sea[near, 0].mean() if near.any() else np.nan); la.append(tr_sea[near, 1].mean() if near.any() else np.nan)
        return np.array(ev), np.array(la)

    print('\nEV/LA from observed distance (Statcast distance + tap error) and hang time (+ stopwatch error):')
    print(f'{"tap σ":>6} {"watch σ":>8} | {"EV MAE":>7} {"LA MAE":>7} | {"dist-only EV":>12} {"LA":>5} | hard-hit(≥95) acc  LA-band acc')
    for sd_d, sd_t in [(3, 0.1), (5, 0.2), (5, 0.3), (8, 0.3), (5, 0.5)]:
        dobs = sea[:, 2] + rng.normal(0, sd_d, len(sea)); tobs = true_t + rng.normal(0, sd_t, len(sea))
        cost = ((gd[None, :] - dobs[:, None]) / sd_d) ** 2 + ((gt[None, :] - tobs[:, None]) / sd_t) ** 2
        w = np.exp(-0.5 * (cost - cost.min(axis=1, keepdims=True)))
        ev_hat = (w * gev).sum(1) / w.sum(1); la_hat = (w * gla).sum(1) / w.sum(1)
        bev, bla = from_distance(dobs)
        hard = (sea[:, 0] >= 95); hard_hat = ev_hat >= 95
        band = lambda la: np.digitize(la, [20, 32])  # line drive / fly / high fly
        print(f'{sd_d:>5}m {sd_t:>7}s | {np.mean(np.abs(ev_hat - sea[:, 0])):>5.1f}mph {np.mean(np.abs(la_hat - sea[:, 1])):>5.1f}° |'
              f' {np.nanmean(np.abs(bev - sea[:, 0])):>10.1f}mph {np.nanmean(np.abs(bla - sea[:, 1])):>4.1f}° |'
              f' {np.mean(hard == hard_hat):>8.0%} (dist-only {np.nanmean(hard == (bev >= 95)):.0%})'
              f'  {np.mean(band(sea[:, 1]) == band(la_hat)):>5.0%} (dist-only {np.nanmean(band(sea[:, 1]) == band(bla)):.0%})')
    print(f'\nshare hard-hit in test: {np.mean(sea[:, 0] >= 95):.0%}; LA bands <20 / 20-32 / >32: '
          + ' / '.join(f'{np.mean(np.digitize(sea[:, 1], [20, 32]) == k):.0%}' for k in range(3)))

if __name__ == '__main__':
    main()
