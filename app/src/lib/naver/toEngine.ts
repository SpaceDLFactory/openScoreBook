// Naver plate appearances -> engine events with the runner moves Naver's base states show, and a comparison of
// the engine's derived score and box with Naver's.
import type { Advance, Derived, EngineConfig, EngineEvent, PaResultType, Spot } from '../engine';
import type { Game, PA, Play } from './parse';
import { stripName } from '../notation';

/** Engine result for a PA's result text; null when the engine has no equivalent. */
export function engineResult(pa: PA): PaResultType | null {
  const t = stripName(pa.result ?? '');
  if (!t) return null;
  if (/삼진|낫 ?아웃/.test(t)) return 'Strikeout';
  if (/볼넷|고의/.test(t)) return 'Walk';
  if (/몸에 맞는/.test(t)) return 'HitByPitch';
  if (/홈런/.test(t)) return 'HomeRun';
  if (/3루타/.test(t)) return 'Triple';
  if (/2루타/.test(t)) return 'Double';
  if (/1루타|내야안타/.test(t)) return 'Single';
  if (/실책/.test(t)) return 'Error';
  if (/야수선택|땅볼로 출루/.test(t)) return 'FieldersChoice';
  if (/병살|삼중살/.test(t)) return 'DoublePlay';
  if (/희생플라이/.test(t)) return 'SacFly';
  if (/희생번트/.test(t)) return 'SacBunt';
  if (/플라이|라인드라이브|직선타/.test(t)) return 'FlyOut';
  if (/땅볼|번트/.test(t)) return 'GroundOut';
  return null;
}

const BASE: Spot[] = ['First', 'Second', 'Third'];

/** Runner moves on a play, read off Naver's base states (each base holds the runner's batting slot). A runner
 *  who left the bases scored or was put out: his runner line says which ("2루주자 X : 홈인"). Without a line the
 *  play's run and out counts decide, lead runners scoring first; when that guess has to pick who scored and who
 *  was out, or the moves don't add up to Naver's counts, `issue` says so. A run scored on a wild pitch, passed
 *  ball, balk or error is marked no_rbi. */
export function playAdvances(p: Play, top: boolean, batterSlot: number | null, resultText: string | null) {
  const { before, after } = p;
  const runs = top ? after.awayScore - before.awayScore : after.homeScore - before.homeScore;
  const outs = after.out - before.out;
  const where = new Map<number, number>();
  after.bases.forEach((slot, i) => slot && where.set(slot, i));
  const advances: Advance[] = [];
  type Gone = { from: Spot; base: number; line: string | undefined };
  const gone: Gone[] = [];
  const lineOf = (prefix: string) => p.texts.find((t) => t.startsWith(prefix));
  before.bases.forEach((slot, i) => {
    if (!slot) return;
    const j = where.get(slot);
    if (j === undefined) gone.push({ from: BASE[i], base: i + 1, line: lineOf(`${i + 1}루주자 `) });
    else if (j !== i) advances.push({ from: BASE[i], to: BASE[j] });
  });
  if (batterSlot !== null) {
    const j = where.get(batterSlot);
    if (j !== undefined) advances.push({ from: 'Batter', to: BASE[j] });
    else gone.push({ from: 'Batter', base: 0, line: /홈런/.test(resultText ?? '') ? '홈런 홈인' : lineOf('타자주자 ') });
  }
  const hinted = (g: Gone): 'Home' | 'Out' | null => (g.line && /홈인/.test(g.line) ? 'Home' : g.line && /아웃/.test(g.line) ? 'Out' : null);
  let homesLeft = runs - gone.filter((g) => hinted(g) === 'Home').length;
  let outsLeft = outs - gone.filter((g) => hinted(g) === 'Out').length;
  const guessed: ('Home' | 'Out')[] = [];
  // lead runner first; the batter last, and he is the one put out when an out is left
  for (const g of [...gone].sort((x, y) => (y.base || -1) - (x.base || -1))) {
    let to = hinted(g);
    if (!to) {
      to = g.from === 'Batter' ? (outsLeft > 0 ? 'Out' : homesLeft > 0 ? 'Home' : 'Out') : homesLeft > 0 ? 'Home' : 'Out';
      if (to === 'Home') homesLeft--; else outsLeft--;
      guessed.push(to);
    }
    const a: Advance = { from: g.from, to };
    if (to === 'Home' && g.line && /폭투|포일|보크|실책/.test(g.line)) a.no_rbi = true;
    advances.push(a);
  }
  const n = (to: Spot) => advances.filter((a) => a.to === to).length;
  const issue = n('Home') !== runs || n('Out') !== outs ? `moves give ${n('Home')}R ${n('Out')}O, Naver ${runs}R ${outs}O`
    : guessed.includes('Home') && guessed.includes('Out') ? 'no runner lines: guessed which runner scored and which was out'
    : null;
  return { advances, issue };
}

export function toEngine(g: Game) {
  const starters = (side: 'away' | 'home') =>
    Array.from({ length: 9 }, (_, i) => g.lineups[side].batter.filter((b) => b.batOrder === i + 1).sort((a, b) => a.seqno - b.seqno)[0]?.name ?? `${i + 1}번`);
  const config: EngineConfig = { away: starters('away'), home: starters('home') };
  const events: EngineEvent[] = [], unmapped: PA[] = [], issues: string[] = [];
  // batting slot by player code; a pinch hitter's PA title ("대타 김호령") has no slot number
  const slotOf: Record<string, number> = {};
  for (const side of ['away', 'home'] as const) for (const b of g.lineups[side].batter) slotOf[b.pcode] = b.batOrder;
  for (const pa of g.pas) {
    const slot = slotOf[pa.batter] ?? (+pa.title.split('번')[0] || null);
    for (const p of pa.plays) {
      if (p.kind === 'runners') {
        const { advances, issue } = playAdvances(p, pa.top, null, null);
        if (issue) issues.push(`${pa.inn}${pa.top ? 't' : 'b'} ${p.texts.join(' / ')}: ${issue}`);
        events.push({ kind: 'Runners', advances });
        continue;
      }
      const type = engineResult(pa);
      if (!type) { unmapped.push(pa); continue; }
      const { advances, issue } = playAdvances(p, pa.top, slot, pa.result);
      if (issue) issues.push(`${pa.inn}${pa.top ? 't' : 'b'} ${pa.result}: ${issue}`);
      events.push({ kind: 'PlateAppearance', result: { type }, advances });
    }
  }
  return { config, events, unmapped, issues };
}

/** Runs per half inning, engine vs Naver ("3t": [engine, naver]); only halves that differ. */
export function compareRuns(g: Game, d: Derived): Record<string, [number, number]> {
  const naver: Record<string, number> = {};
  for (const [side, t] of [['away', 't'], ['home', 'b']] as const)
    for (const [inn, v] of Object.entries(g.inningScore[side])) if (Number.isFinite(+v)) naver[inn + t] = +v;
  const engine: Record<string, number> = {};
  for (const h of d.state.linescore) engine[h.inning + (h.half === 'Top' ? 't' : 'b')] = h.runs;
  const out: Record<string, [number, number]> = {};
  for (const k of new Set([...Object.keys(naver), ...Object.keys(engine)]))
    if ((engine[k] ?? 0) !== (naver[k] ?? 0)) out[k] = [engine[k] ?? 0, naver[k] ?? 0];
  return out;
}

const STATS = [['ab', 'ab'], ['h', 'hit'], ['r', 'run'], ['rbi', 'rbi'], ['bb', 'bb'], ['so', 'so']] as const;
/** Batting lines per slot, engine vs Naver's box (summed over everyone who hit in that slot); only differences. */
export function compareBox(g: Game, d: Derived): string[] {
  const out: string[] = [];
  for (const side of ['away', 'home'] as const) {
    const eng = side === 'away' ? d.away_box : d.home_box;
    for (let slot = 1; slot <= 9; slot++) {
      const ps = g.lineups[side].batter.filter((b) => b.batOrder === slot);
      for (const [ek, nk] of STATS) {
        const nv = ps.reduce((t, b) => t + (+b[nk] || 0), 0), ev = eng[slot - 1][ek];
        if (ev !== nv) out.push(`${side} ${slot}번 ${ek}: engine ${ev} naver ${nv}`);
      }
    }
  }
  return out;
}
