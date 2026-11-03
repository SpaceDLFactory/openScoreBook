#!/usr/bin/env python3
"""Fetch Naver Sports KBO text-relay JSON for personal scorebook fixtures.

Unofficial endpoint (api-gw.sports.naver.com). Personal, low-volume use only.
The gateway hangs on HTTP/2 and rejects requests without a browser UA + Referer.
Python's urllib/OpenSSL client times out even with those headers, so this shells
out to the system curl with --http1.1.

Usage:
  naver_relay.py schedule 2026-10-20 2026-10-31
  naver_relay.py relay 55551030SSHT02026 [--out fixtures/naver]
  naver_relay.py watch 77771103SSKT02026 [--every 15] [--out fixtures/naver]
    polls a live game, saving each changed snapshot as live/<unix_ts>.json,
    then fetches all innings once the game reaches RESULT.
"""
import argparse
import json
import pathlib
import sys
import subprocess
import time

BASE = "https://api-gw.sports.naver.com"
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0 Safari/537.36"
)


def get(path, tries=4):
    # The gateway intermittently resets connections (curl exit 56); back off and retry.
    for i in range(tries):
        try:
            out = subprocess.run(
                ["curl", "-sS", "-m", "20", "--http1.1", "-A", UA,
                 "-H", "Referer: https://m.sports.naver.com/", BASE + path],
                check=True, capture_output=True,
            ).stdout
            return json.loads(out)
        except (subprocess.CalledProcessError, json.JSONDecodeError):
            if i == tries - 1:
                raise
            time.sleep(2 ** (i + 1))


def schedule(start, end):
    d = get(
        "/schedule/games?fields=basic&upperCategoryId=kbaseball&categoryId=kbo"
        f"&fromDate={start}&toDate={end}"
    )
    for g in d["result"]["games"]:
        print(
            g["gameId"], g["gameDate"], g["awayTeamName"],
            f'{g["awayTeamScore"]}:{g["homeTeamScore"]}', g["homeTeamName"], g["statusCode"],
        )


def relay(game_id, out):
    d = pathlib.Path(out) / game_id
    d.mkdir(parents=True, exist_ok=True)
    meta = get(f"/schedule/games/{game_id}")["result"]["game"]
    (d / "game.json").write_text(json.dumps(meta, ensure_ascii=False))
    for inn in range(1, 16):
        data = get(f"/schedule/games/{game_id}/relay?inning={inn}")
        n = len(data["result"]["textRelayData"]["textRelays"])
        if n == 0:
            break
        (d / f"inning-{inn}.json").write_text(json.dumps(data, ensure_ascii=False))
        print(f"inning {inn}: {n} relays", file=sys.stderr)
        time.sleep(1)
    write_index(out)


def write_index(out):
    """fixtures/naver/games.json: one summary row per fetched game, newest first."""
    keys = ("gameId", "gameDate", "stadium", "awayTeamName", "homeTeamName", "awayTeamScore", "homeTeamScore", "statusCode")
    rows = [{k: json.loads(f.read_text()).get(k) for k in keys} for f in pathlib.Path(out).glob("*/game.json")]
    rows.sort(key=lambda r: (r["gameDate"] or "", r["gameId"]), reverse=True)
    (pathlib.Path(out) / "games.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1))


def watch(game_id, out, every):
    d = pathlib.Path(out) / game_id / "live"
    d.mkdir(parents=True, exist_ok=True)
    last = None
    while True:
        try:
            status = get(f"/schedule/games/{game_id}")["result"]["game"]["statusCode"]
            snap = get(f"/schedule/games/{game_id}/relay")
        except (subprocess.CalledProcessError, json.JSONDecodeError) as e:
            print(f"fetch failed, retrying: {e}", file=sys.stderr)
            time.sleep(every)
            continue
        body = json.dumps(snap, ensure_ascii=False)
        if body != last:
            ts = int(time.time())
            (d / f"{ts}.json").write_text(body)
            t = snap["result"]["textRelayData"]
            print(f"{ts} {status} inn={t.get('inn')} relays={len(t['textRelays'])}", file=sys.stderr)
            last = body
        if status in ("RESULT", "CANCEL"):
            break
        time.sleep(every)
    relay(game_id, out)


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("schedule")
    s.add_argument("start")
    s.add_argument("end")
    r = sub.add_parser("relay")
    r.add_argument("game_id")
    r.add_argument("--out", default="fixtures/naver")
    w = sub.add_parser("watch")
    w.add_argument("game_id")
    w.add_argument("--out", default="fixtures/naver")
    w.add_argument("--every", type=int, default=15)
    a = ap.parse_args()
    if a.cmd == "schedule":
        schedule(a.start, a.end)
    elif a.cmd == "relay":
        relay(a.game_id, a.out)
    else:
        watch(a.game_id, a.out, a.every)


if __name__ == "__main__":
    main()
