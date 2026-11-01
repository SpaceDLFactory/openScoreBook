#!/usr/bin/env python3
"""Fetch Naver Sports KBO text-relay JSON for personal scorebook fixtures.

Unofficial endpoint (api-gw.sports.naver.com). Personal, low-volume use only.
The gateway hangs on HTTP/2 and rejects requests without a browser UA + Referer.
Python's urllib/OpenSSL client times out even with those headers, so this shells
out to the system curl with --http1.1.

Usage:
  naver_relay.py schedule 2026-10-20 2026-10-31
  naver_relay.py relay 55551030SSHT02026 [--out fixtures/naver]
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


def get(path):
    out = subprocess.run(
        ["curl", "-sS", "-m", "20", "--http1.1", "-A", UA,
         "-H", "Referer: https://m.sports.naver.com/", BASE + path],
        check=True, capture_output=True,
    ).stdout
    return json.loads(out)


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
    for inn in range(1, 16):
        data = get(f"/schedule/games/{game_id}/relay?inning={inn}")
        n = len(data["result"]["textRelayData"]["textRelays"])
        if n == 0:
            break
        (d / f"inning-{inn}.json").write_text(json.dumps(data, ensure_ascii=False))
        print(f"inning {inn}: {n} relays", file=sys.stderr)
        time.sleep(1)


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("schedule")
    s.add_argument("start")
    s.add_argument("end")
    r = sub.add_parser("relay")
    r.add_argument("game_id")
    r.add_argument("--out", default="fixtures/naver")
    a = ap.parse_args()
    if a.cmd == "schedule":
        schedule(a.start, a.end)
    else:
        relay(a.game_id, a.out)


if __name__ == "__main__":
    main()
