# park_fence

Measures each KBO park's outfield wall on aerial imagery and writes the 1-degree fence profiles in
`app/src/lib/stadiums.ts`. Per-park inputs and the reasoning behind them live in `parks.json`.

```sh
python3 tools/park_fence/park_fence.py fetch 수원        # VWorld z19 mosaic -> fixtures/parks/ (gitignored)
python3 tools/park_fence/park_fence.py measure 수원      # foul lines -> home plate, wall trace, raw profile
python3 tools/park_fence/park_fence.py overlay 수원      # fixtures/parks/수원.overlay.png: check the trace by eye
python3 tools/park_fence/park_fence.py profiles          # final profiles + labels (add --write to update the app)
```

Without park names, `fetch`/`measure` run every park in parks.json. Needs Pillow and curl.

How it works:
- **Home plate**: the two chalk foul lines are found near a rough guess (`home`: pixel and CF bearing); their
  intersection is home, their bisector the CF direction. They should meet at about 90 deg (89.7-90.6 here).
  대전 uses `mound` instead (home = mound - 18.0 m) because the line search locks onto other lines there.
- **Wall**: every 0.5 deg from home, the grass edge is found, then the wall = an edge 2-9 m past it (outer edge of
  the warning track). Between the first strong edge and the strongest one, a Viterbi pass keeps the wall
  continuous; outliers against the +-2 deg median are dropped.
- **Profile**: distance every 1 deg to that traced wall, then per park (`method`): one robust polynomial (arcs),
  straight walls between RDP corners (대전), or the square model (대구, 창원: side walls square to the foul lines at
  the pole distance plus a flat CF wall). Official/press distances (`anchors`) shift it linearly in angle.
- 고척 is a dome (no aerial view of the field) and keeps its published values.

Expect about +-1-2 m where a wall meets the rays at a shallow angle or lies in a stand's shadow.
