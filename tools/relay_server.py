#!/usr/bin/env python3
"""Serve the built app and live Naver relay data to it, for personal use on your own network.

  relay_server.py [--port 8770] [--dist app/dist]
  relay_server.py --replay 77771103SSKT02026 [--speed 20]   # replay a fetched game as if it were live

The data is laid out like fixtures/naver, so the app reads it the same way:
  /api/games.json            today's KBO games (Naver schedule) plus every game in fixtures/naver
  /api/<id>/game.json        game meta (status, score, stadium)
  /api/<id>/inning-N.json    relay of inning N; 404 once there is no such inning yet
Naver is asked only when the app asks, through naver_relay.get (curl, HTTP/1.1, browser UA + Referer), with a
short cache for games in progress; finished games already in fixtures/naver are served from disk.
Replay mode shows a fetched game's relays a few at a time (one plate appearance every 10 s / speed) with status
STARTED until the end. The box score it shows is the final one (the fixture only has that).
"""
import argparse
import datetime
import json
import pathlib
import sys
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import naver_relay  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
FIX = ROOT / "fixtures" / "naver"
LIVE_TTL = 15  # s; Naver's relay itself updates every few seconds


class Cache:
    def __init__(self):
        self.lock = threading.Lock()
        self.data = {}

    def peek(self, key):
        with self.lock:
            hit = self.data.get(key)
        return hit[1] if hit else None

    def get(self, key, ttl, fetch):
        with self.lock:
            hit = self.data.get(key)
            if hit and (ttl is None or time.time() - hit[0] < ttl):
                return hit[1]
        value = fetch()
        with self.lock:
            self.data[key] = (time.time(), value)
        return value


CACHE = Cache()
REPLAY = {}  # gameId -> {"start": t0, "speed": s, "relays": [(inning, no), ...]}


def fixture(game_id, name):
    f = FIX / game_id / name
    return json.loads(f.read_text()) if f.exists() else None


def finished_on_disk(game_id):
    meta = fixture(game_id, "game.json")
    return meta is not None and meta.get("statusCode") == "RESULT" and (FIX / game_id / "inning-1.json").exists()


# ---------------------------------------------------------------- replay
def replay_cut(game_id):
    """how many relays (in game order) are visible now"""
    r = REPLAY[game_id]
    return min(len(r["relays"]), 1 + int((time.time() - r["start"]) * r["speed"] / 10))


def replay_setup(game_id, speed):
    order = []
    for i in range(1, 16):
        inn = fixture(game_id, f"inning-{i}.json")
        if not inn:
            break
        order += [(i, r["no"]) for r in sorted(inn["result"]["textRelayData"]["textRelays"], key=lambda r: r["no"])]
    REPLAY[game_id] = {"start": time.time(), "speed": speed, "relays": order}


def replay_meta(game_id):
    meta = dict(fixture(game_id, "game.json"))
    cut = replay_cut(game_id)
    meta["statusCode"] = "RESULT" if cut >= len(REPLAY[game_id]["relays"]) else "STARTED"
    return meta


def replay_inning(game_id, n):
    visible = set(REPLAY[game_id]["relays"][:replay_cut(game_id)])
    inn = fixture(game_id, f"inning-{n}.json")
    if not inn:
        return None
    t = inn["result"]["textRelayData"]
    t["textRelays"] = [r for r in t["textRelays"] if (n, r["no"]) in visible]
    return inn if t["textRelays"] else None


# ---------------------------------------------------------------- live
def games():
    today = datetime.date.today().isoformat()

    def schedule():
        rows = naver_relay.get("/schedule/games?fields=basic&upperCategoryId=kbaseball&categoryId=kbo"
                               f"&fromDate={today}&toDate={today}")["result"]["games"]
        keys = ("gameId", "gameDate", "stadium", "awayTeamName", "homeTeamName", "awayTeamScore", "homeTeamScore", "statusCode")
        return [{k: g.get(k) for k in keys} for g in rows]

    try:
        live = CACHE.get(("schedule", today), 60, schedule)
    except Exception as e:  # Naver unreachable: still list what is on disk
        print(f"schedule: {e}", file=sys.stderr)
        live = []
    disk = json.loads((FIX / "games.json").read_text()) if (FIX / "games.json").exists() else []
    if REPLAY:
        disk = [dict(g, statusCode="STARTED") if g["gameId"] in REPLAY else g for g in disk]
    seen = {g["gameId"] for g in live}
    return live + [g for g in disk if g["gameId"] not in seen]


def meta(game_id):
    if game_id in REPLAY:
        return replay_meta(game_id)
    if finished_on_disk(game_id):
        return fixture(game_id, "game.json")
    return CACHE.get(("meta", game_id), LIVE_TTL, lambda: naver_relay.get(f"/schedule/games/{game_id}")["result"]["game"])


def inning(game_id, n):
    if game_id in REPLAY:
        return replay_inning(game_id, n)
    if finished_on_disk(game_id):
        return fixture(game_id, f"inning-{n}.json")
    has = lambda d: bool(d and d["result"]["textRelayData"]["textRelays"])  # noqa: E731
    # an inning is over once the next one has relays: then Naver need not be asked again
    over = meta(game_id).get("statusCode") == "RESULT" or has(CACHE.peek(("inning", game_id, n + 1)))
    data = CACHE.get(("inning", game_id, n), None if over else LIVE_TTL,
                     lambda: naver_relay.get(f"/schedule/games/{game_id}/relay?inning={n}"))
    return data if has(data) else None


# ---------------------------------------------------------------- http
class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split("?")[0]
        if not path.startswith("/api/"):
            return super().do_GET()
        parts = path[len("/api/"):].split("/")
        try:
            if parts == ["games.json"]:
                body = games()
            elif len(parts) == 2 and parts[1] == "game.json":
                body = meta(parts[0])
            elif len(parts) == 2 and parts[1].startswith("inning-") and parts[1].endswith(".json"):
                body = inning(parts[0], int(parts[1][len("inning-"):-len(".json")]))
            else:
                body = None
        except Exception as e:
            self.send_error(502, f"naver: {e}")
            return
        if body is None:
            self.send_error(404)
            return
        raw = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, fmt, *args):
        if "/api/" in self.path:
            sys.stderr.write("%s %s\n" % (self.log_date_time_string(), fmt % args))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8770)
    ap.add_argument("--host", default="127.0.0.1", help="0.0.0.0 to reach it from your phone on the same network")
    ap.add_argument("--dist", default=str(ROOT / "app" / "dist"))
    ap.add_argument("--replay", action="append", default=[], metavar="GAME_ID")
    ap.add_argument("--speed", type=float, default=20, help="replay: plate appearances per 10 s")
    a = ap.parse_args()
    for g in a.replay:
        replay_setup(g, a.speed)
    handler = lambda *x, **k: Handler(*x, directory=a.dist, **k)  # noqa: E731
    print(f"serving {a.dist} and /api on http://{a.host}:{a.port}/", file=sys.stderr)
    ThreadingHTTPServer((a.host, a.port), handler).serve_forever()


if __name__ == "__main__":
    main()
