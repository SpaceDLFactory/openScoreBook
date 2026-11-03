#!/usr/bin/env python3
"""Bundle web/index.html + one game's relay fixture into a standalone page.

The output has no fetches (data is inlined, trimmed to the fields the page
reads), so it can be opened from anywhere, e.g. published as a private artifact.
It contains Naver relay data: keep it out of git and do not share it publicly.

Usage: build_mockup.py [GAME_ID] [OUT]
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
game = sys.argv[1] if len(sys.argv) > 1 else "55551030SSHT02026"
out = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else ROOT / "web/dist/mockup.html")

OPT = ("seqno", "type", "text", "pitchNum", "pitchResult", "speed", "stuff", "ptsPitchId", "currentGameState")
PTS = ("pitchId", "crossPlateX", "crossPlateY", "y0", "z0", "vy0", "vz0", "ay", "az", "bottomSz", "topSz")
BAT = ("pcode", "name", "hitType", "batOrder", "seqno", "posName", "ab", "hit", "rbi", "run", "bb", "so")
PIT = ("pcode", "name", "hitType", "seqno", "inn", "ballCount", "hit", "kk", "bb", "er")


def pick(d, keys):
    return {k: d.get(k) for k in keys}


def lineup(l):
    return {"batter": [pick(b, BAT) for b in l["batter"]], "pitcher": [pick(p, PIT) for p in l["pitcher"]]}


innings = []
files = sorted((ROOT / "fixtures/naver" / game).glob("inning-*.json"), key=lambda f: int(f.stem.split("-")[1]))
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

html = (ROOT / "web/index.html").read_text()
data = json.dumps(innings, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
meta_f = ROOT / "fixtures/naver" / game / "game.json"
meta = json.loads(meta_f.read_text()) if meta_f.exists() else {}
meta = {k: meta.get(k) for k in ("gameId", "gameDate", "stadium", "homeTeamName", "awayTeamName")}
inject = (f"<script>window.INLINE_INNINGS = {data};\nwindow.INLINE_GAME = {json.dumps(meta, ensure_ascii=False)};</script>\n"
          f"<script>\nconst GAME_ID_OVERRIDE = '{game}';")
assert html.count("<script>\n") == 1
html = html.replace("<script>\n", inject + "\n", 1)
assert "URLSearchParams(location.search)" in html
html = html.replace("const GAME = new URLSearchParams(location.search).get('game') || '55551030SSHT02026';",
                    "const GAME = GAME_ID_OVERRIDE;")
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(html)
print(f"{out} {len(html) // 1024} KB, {len(innings)} innings")
