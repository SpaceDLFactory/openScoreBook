#!/usr/bin/env python3
"""Bundle web/index.html + fetched relay fixtures into a standalone page.

The output has no fetches (data is inlined, trimmed to the fields the page
reads), so it can be opened from anywhere, e.g. published as a private artifact.
It contains Naver relay data: keep it out of git and do not share it publicly.

Usage: build_mockup.py [GAME_ID ...] [OUT.html]   (default: every fetched game)
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
NAVER = ROOT / "fixtures/naver"
args = sys.argv[1:]
out = pathlib.Path(args.pop() if args and args[-1].endswith(".html") else ROOT / "web/dist/mockup.html")
games = args or sorted(d.name for d in NAVER.iterdir() if (d / "inning-1.json").exists())

OPT = ("seqno", "type", "text", "pitchNum", "pitchResult", "speed", "stuff", "ptsPitchId", "currentGameState")
PTS = ("pitchId", "crossPlateX", "crossPlateY", "y0", "z0", "vy0", "vz0", "ay", "az", "bottomSz", "topSz")
BAT = ("pcode", "name", "hitType", "batOrder", "seqno", "posName", "ab", "hit", "rbi", "run", "bb", "so")
PIT = ("pcode", "name", "hitType", "seqno", "inn", "ballCount", "hit", "kk", "bb", "er")


def pick(d, keys):
    return {k: d.get(k) for k in keys}


def lineup(l):
    return {"batter": [pick(b, BAT) for b in l["batter"]], "pitcher": [pick(p, PIT) for p in l["pitcher"]]}


def bundle(game):
    innings = []
    files = sorted((NAVER / game).glob("inning-*.json"), key=lambda f: int(f.stem.split("-")[1]))
    for f in files:
        t = json.loads(f.read_text())["result"]["textRelayData"]
        innings.append({
            "inningScore": t["inningScore"],
            "awayLineup": lineup(t["awayLineup"]),
            "homeLineup": lineup(t["homeLineup"]),
            "textRelays": [{
                "no": r["no"], "inn": r["inn"], "homeOrAway": r["homeOrAway"], "title": r["title"],
                "metricOption": r.get("metricOption"),
                "textOptions": [pick(o, OPT) for o in r["textOptions"]],
                "ptsOptions": [pick(p, PTS) for p in r["ptsOptions"]],
            } for r in t["textRelays"]],
        })
    if not innings:
        sys.exit(f"no fixture for {game}; run tools/naver_relay.py relay {game}")
    meta_f = NAVER / game / "game.json"
    meta = json.loads(meta_f.read_text()) if meta_f.exists() else {"gameId": game}
    keys = ("gameId", "gameDate", "stadium", "homeTeamName", "awayTeamName", "homeTeamScore", "awayTeamScore")
    return {"meta": {k: meta.get(k) for k in keys}, "innings": innings}


data = json.dumps({g: bundle(g) for g in games}, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
html = (ROOT / "web/index.html").read_text()
assert html.count("<script>\n") == 1
html = html.replace("<script>\n", f"<script>window.INLINE_GAMES = {data};</script>\n<script>\n", 1)
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(html)
print(f"{out} {len(html) // 1024} KB, games: {', '.join(games)}")
