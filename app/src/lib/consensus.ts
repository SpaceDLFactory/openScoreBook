// Several independent records of one game merged into one: plate appearances lined up per half inning, then every
// value voted on (result, situation after, pitch count, each pitch's call, location, type and speed, landing point).
// A value is settled when a majority of those who recorded it agree, and at least two do; one recorded by a single
// scorer is taken as is; anything else is a dispute. The merged game is rebuilt from events, one record per PA
// (the one that best matches the vote), with pitch details replaced by the voted values. Substitutions are voted on
// apart from the PAs (who, and where among the pitches and runner plays of which PA), so changing records from one
// PA to the next can't
// drop or repeat one.
import { align, LANDING_TOL, resultOf, situation, slotOf, SPEED_TOL, type Tally } from './compare';
import type { Derived } from './engine';
import type { LandingEvent } from './events';
import type { Landing, Landings } from './landings';
import { engineEvents, type ManualEvent } from './manual';
import type { Game, PA } from './naver/parse';
import { zoneOf } from './scout';

export interface Source {
  label: string;
  /** the edits in effect (resolve()d), m.setup first */
  edits: ManualEvent[];
  /** deriveSteps of engineEvents(edits) */
  steps: Derived[];
  game: Game;
  landings: Landings;
}
export const FIELDS = ['타석', '결과', '타석 후', '투구 수', '판정', '코스', '구종', '구속', '낙구지점', '교체'] as const;
export type Field = (typeof FIELDS)[number];
export interface Dispute { inn: number; top: boolean; slot: number; title: string; field: string; values: { label: string; value: string }[] }
export interface Consensus {
  /** the merged game's edits, m.setup first (the first source's setup) */
  edits: ManualEvent[];
  landings: LandingEvent[];
  disputes: Dispute[];
  /** per field: values settled (agree) out of those two or more scorers recorded (both) */
  settled: Record<Field, Tally>;
  /** per source: how many settled values it recorded, and how many of them it had right */
  scorers: { label: string; agree: number; total: number }[];
  /** the plate appearances the merged edits should replay to, in order */
  plan: { inn: number; top: boolean; slot: number }[];
}

/** The edits of each plate appearance, in the order of game.pas: a PA closes on its result, or on a runner play
 *  that ends the half; substitutions before a PA go with it. Edits after the last PA (substitutions only) are
 *  the tail. */
export function segments(edits: readonly ManualEvent[], steps: readonly Derived[]): { pas: ManualEvent[][]; tail: ManualEvent[] } {
  const { at } = engineEvents(edits);
  const out: ManualEvent[][] = [];
  let cur: ManualEvent[] = [], opened = false;
  edits.forEach((e, i) => {
    if (e.kind === 'm.setup') return;
    cur.push(e);
    if (e.kind === 'm.pitch' || e.kind === 'm.runners' || e.kind === 'm.pa') opened = true;
    const k = at[i];
    const endsHalf = e.kind === 'm.runners' && steps[k].state.half !== (k > 0 ? steps[k - 1].state.half : 'Top');
    if (e.kind === 'm.pa' || endsHalf) { out.push(cur); cur = []; opened = false; }
  });
  if (opened) { out.push(cur); cur = []; }
  return { pas: out, tail: cur };
}

type Vote<T> = { value: T | null; settled: boolean; contested: boolean };
/** majority among the values given; settled needs at least two in agreement */
function vote<T>(vals: T[], key: (v: T) => string = String): Vote<T> {
  if (!vals.length) return { value: null, settled: false, contested: false };
  const groups = new Map<string, T[]>();
  for (const v of vals) groups.set(key(v), [...(groups.get(key(v)) ?? []), v]);
  const top = [...groups.values()].sort((a, b) => b.length - a.length)[0];
  const settled = vals.length >= 2 && top.length >= 2 && top.length * 2 > vals.length;
  return { value: top[0], settled, contested: vals.length >= 2 && !settled };
}
const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b), k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };
/** Readings that agree within tol of one of them (the one most others are near; the first on a tie), the same
 *  test the side-by-side comparison uses; settled when they are a majority of at least two. */
function cluster<T>(items: T[], dist: (a: T, b: T) => number, tol: number) {
  const near = (a: T) => items.filter((b) => dist(a, b) <= tol);
  const anchor = items.reduce((best, x) => (near(x).length > near(best).length ? x : best), items[0]);
  const close = near(anchor);
  const settled = items.length >= 2 && close.length >= 2 && close.length * 2 > items.length;
  return { close, settled, contested: items.length >= 2 && !settled };
}

type Sub = ManualEvent & { kind: 'm.sub' };
const subKey = (e: Sub) => `${e.side}|${e.role}|${e.slot}|${e.player.name}`;
const BATTED = (r: string) => !['Walk', 'HitByPitch', 'Strikeout'].includes(r);

/** Do these calls fit how the PA ended? Nothing ends it before its last pitch (a fourth ball, a third strike, a
 *  ball in play), and the last one agrees with the end: four balls with a walk, three strikes with a strikeout,
 *  a ball in play with a batted result; a PA without a result (in progress, or the half ended on a runner play)
 *  must not be over by its count. */
function callsFit(calls: string[], end: ManualEvent | undefined): boolean {
  let b = 0, s = 0;
  for (let q = 0; q < calls.length; q++) {
    if (b >= 4 || s >= 3) return false;
    const c = calls[q];
    if (c === 'H' && q < calls.length - 1) return false;
    if (c === 'B') b++;
    else if (c === 'T' || c === 'S') s++;
    else if ((c === 'F' || c === 'W') && s < 2) s++;
  }
  const walk = b >= 4, out = s >= 3, inPlay = calls.at(-1) === 'H';
  if (end?.kind !== 'm.pa') return !walk && !out && !inPlay;
  const r = end.result, plainWalk = r === 'Walk' && !end.ibb;
  return walk === plainWalk && out === (r === 'Strikeout') && (!inPlay || BATTED(r));
}

export function consensus(sources: Source[]): Consensus {
  if (sources.length < 2) throw new Error('기록이 두 개 이상 있어야 해요.');
  const N = sources.length;
  const settled = Object.fromEntries(FIELDS.map((f) => [f, { both: 0, agree: 0 }])) as Record<Field, Tally>;
  const scorers = sources.map((s) => ({ label: s.label, agree: 0, total: 0 }));
  const disputes: Dispute[] = [];
  const segs = sources.map((s) => {
    const sg = segments(s.edits, s.steps);
    if (sg.pas.length !== s.game.pas.length) throw new Error(`${s.label} 기록을 타석으로 나누지 못했어요.`);
    return sg;
  });

  // halves in play order; a half counts when most records have it
  const halfOf = (p: PA) => p.inn * 2 + (p.top ? 0 : 1);
  const halves = [...new Set(sources.flatMap((s) => s.game.pas.map(halfOf)))].sort((a, b) => a - b)
    .filter((h) => sources.filter((s) => s.game.pas.some((p) => halfOf(p) === h)).length * 2 > N);

  interface Planned {
    inn: number; top: boolean; slot: number; title: string;
    witness: { r: number; i: number };
    calls: string[];
    patch: { x?: number; z?: number; stuff?: string; speed?: number }[];
    landing: Landing | null;
  }
  const plan: Planned[] = [];
  /** per source: its PA index -> the merged PA it became */
  const placed = sources.map(() => new Map<number, number>());

  for (const h of halves) {
    const inn = h >> 1, top = h % 2 === 0;
    const lists = sources.map((s) => s.game.pas.map((p, i) => ({ p, i })).filter(({ p }) => halfOf(p) === h));
    const slots = lists.map((l, r) => l.map(({ p }) => slotOf(sources[r].game, p)));
    // the batting order of the half: the record's that lines up best with the others (itself not counted)
    const fit = slots.map((xs, a) => slots.reduce((t, ys, b) => (a === b ? t : t + align(xs, ys).filter(([i, j]) => i != null && j != null).length), 0));
    const ref = fit.indexOf(Math.max(...fit));
    const paired = slots.map((ys) => {
      const m = new Map<number, number>();
      for (const [i, j] of align(slots[ref], ys)) if (i != null && j != null) m.set(i, j);
      return m;
    });
    let prevAfter: string | null = null;
    slots[ref].forEach((slot, k) => {
      const who = sources.flatMap((_, r) => { const j = paired[r].get(k); return j == null ? [] : [{ r, p: lists[r][j].p, i: lists[r][j].i }]; });
      const title = lists[ref][k].p.title;
      const note = (field: Field, v: Vote<unknown>, values: { r: number; v: string }[]) => {
        if (v.settled || v.contested) settled[field].both++;
        if (v.settled) {
          settled[field].agree++;
          for (const x of values) { scorers[x.r].total++; if (x.v === String(v.value)) scorers[x.r].agree++; }
        } else if (v.contested) disputes.push({ inn, top, slot, title, field, values: values.map((x) => ({ label: sources[x.r].label, value: x.v })) });
      };
      // the PA itself: kept when most scorers have it
      const kept = who.length * 2 > N;
      const there = { value: '있음', settled: kept && who.length >= 2, contested: !kept };
      note('타석', there, sources.map((_, r) => ({ r, v: who.some((x) => x.r === r) ? '있음' : '없음' })));
      if (!kept) return;

      const res = vote(who.map((x) => resultOf(x.p) ?? '진행 중'));
      note('결과', res, who.map((x) => ({ r: x.r, v: resultOf(x.p) ?? '진행 중' })));
      const same = who.filter((x) => (resultOf(x.p) ?? '진행 중') === res.value);
      const after = vote(same.map((x) => situation(x.p.after)));
      if (res.value !== '진행 중') note('타석 후', after, same.map((x) => ({ r: x.r, v: situation(x.p.after) })));
      const count = vote(who.map((x) => x.p.pitches.length));
      note('투구 수', count, who.map((x) => ({ r: x.r, v: String(x.p.pitches.length) })));

      // pitch by pitch, among the records with the voted pitch count (an extra pitch would shift the rest)
      const n = count.value ?? 0, full = who.filter((x) => x.p.pitches.length === n);
      const pitchers = full.length >= 2 ? full : who;
      const calls: (string | null)[] = [];
      const patch: Planned['patch'] = [];
      for (let q = 0; q < n; q++) {
        const ps = pitchers.flatMap((x) => (x.p.pitches[q] ? [{ r: x.r, pt: x.p.pitches[q] }] : []));
        const call = vote(ps.map((x) => x.pt.call));
        note('판정', call, ps.map((x) => ({ r: x.r, v: x.pt.call })));
        calls.push(call.settled ? call.value : null);
        const fix: Planned['patch'][number] = {};
        const located = ps.filter((x) => x.pt.xz).map((x) => ({ ...x, zone: zoneOf(x.pt)! }));
        const zone = vote(located.map((x) => x.zone));
        note('코스', zone, located.map((x) => ({ r: x.r, v: String(x.zone) })));
        if (zone.settled || located.length === 1) {
          const inZone = located.filter((x) => x.zone === zone.value);
          fix.x = median(inZone.map((x) => x.pt.xz![0])); fix.z = median(inZone.map((x) => x.pt.xz![1]));
        }
        const typed = ps.filter((x) => x.pt.stuff);
        const stuff = vote(typed.map((x) => x.pt.stuff!));
        note('구종', stuff, typed.map((x) => ({ r: x.r, v: x.pt.stuff! })));
        if (stuff.settled || typed.length === 1) fix.stuff = stuff.value!;
        const timed = ps.filter((x) => x.pt.speed);
        if (timed.length) {
          const speed = cluster(timed, (a, b) => Math.abs(+a.pt.speed! - +b.pt.speed!), SPEED_TOL);
          if (speed.settled || speed.contested) settled['구속'].both++;
          if (speed.settled) {
            settled['구속'].agree++;
            for (const x of timed) { scorers[x.r].total++; if (speed.close.includes(x)) scorers[x.r].agree++; }
          } else if (speed.contested) disputes.push({ inn, top, slot, title, field: '구속', values: timed.map((x) => ({ label: sources[x.r].label, value: x.pt.speed! })) });
          if (speed.settled || timed.length === 1) fix.speed = Math.round(median(speed.close.map((x) => +x.pt.speed!)));
        }
        patch.push(fix);
      }

      const lands = who.flatMap((x) => { const l = sources[x.r].landings[x.p.no]; return l ? [{ r: x.r, l }] : []; });
      let landing: Landing | null = null;
      if (lands.length) {
        const { close, settled: ok } = cluster(lands, (a, b) => Math.hypot(a.l.x - b.l.x, a.l.y - b.l.y), LANDING_TOL);
        const mx = median(close.map((x) => x.l.x)), my = median(close.map((x) => x.l.y));
        const dist = (l: Landing) => Math.hypot(l.x - mx, l.y - my);
        if (lands.length >= 2) settled['낙구지점'].both++;
        if (ok) {
          settled['낙구지점'].agree++;
          for (const x of lands) { scorers[x.r].total++; if (close.includes(x)) scorers[x.r].agree++; }
        } else if (lands.length >= 2) disputes.push({ inn, top, slot, title, field: '낙구지점', values: lands.map((x) => ({ label: sources[x.r].label, value: `${x.l.x.toFixed(1)}, ${x.l.y.toFixed(1)}m` })) });
        if (ok || lands.length === 1) {
          // the path, result and trajectory of the reading nearest the agreed point
          const best = [...close].sort((a, b) => dist(a.l) - dist(b.l))[0].l;
          landing = { ...best, x: mx, y: my };
        }
      }

      // the record whose events stand for this PA: continuing the half's situation, then closest to the vote
      const callsOf = (x: (typeof who)[number]) => x.p.pitches.map((p) => p.call);
      const score = (x: (typeof who)[number]) =>
        (prevAfter == null || situation(x.p.before) === prevAfter ? 16 : 0) + ((resultOf(x.p) ?? '진행 중') === res.value ? 8 : 0) +
        (situation(x.p.after) === after.value ? 4 : 0) + (x.p.pitches.length === n ? 2 : 0) +
        (callsOf(x).every((c, q) => calls[q] == null || calls[q] === c) ? 1 : 0);
      const witness = [...who].sort((a, b) => score(b) - score(a) || a.r - b.r)[0];
      // the voted calls where settled, the witness's elsewhere; kept only if they still end the PA where it ends
      let use = callsOf(witness).map((c, q) => calls[q] ?? c);
      const end = segs[witness.r].pas[witness.i].filter((e) => e.kind !== 'm.sub').at(-1);
      if (use.join() !== callsOf(witness).join() && (use.length !== callsOf(witness).length || !callsFit(use, end))) {
        disputes.push({ inn, top, slot, title, field: '판정', values: who.map((x) => ({ label: sources[x.r].label, value: callsOf(x).join(' ') })) });
        use = callsOf(witness);
      }
      for (const x of who) placed[x.r].set(x.i, plan.length);
      plan.push({ inn, top, slot, title, witness: { r: witness.r, i: witness.i }, calls: use, patch, landing });
      prevAfter = situation(witness.p.after);
    });
  }

  // substitutions: who came in, and where (which merged PA, after how many of its pitches and runner plays), by
  // vote. The same change made twice (two relievers of one name) is told apart by its count.
  interface Seen { r: number; e: Sub; at: number; before: number }
  const seen = new Map<string, Seen[]>();
  sources.forEach((_, r) => {
    const times = new Map<string, number>();
    const add = (e: ManualEvent, at: number, before: number) => {
      if (e.kind !== 'm.sub') return;
      const n = (times.get(subKey(e)) ?? 0) + 1;
      times.set(subKey(e), n);
      const k = `${subKey(e)}|${n}`, l = seen.get(k) ?? [];
      l.push({ r, e, at, before });
      seen.set(k, l);
    };
    segs[r].pas.forEach((seg, i) => {
      // a PA left out of the merge: its substitutions go with the next one that was kept
      let at = placed[r].get(i), j = i;
      while (at == null && ++j < segs[r].pas.length) at = placed[r].get(j);
      const exact = j === i;
      let done = 0; // pitches and runner plays so far in this PA
      for (const e of seg) { if (e.kind !== 'm.sub') done++; add(e, at ?? plan.length, exact ? done : 0); }
    });
    for (const e of segs[r].tail) add(e, plan.length, 0);
  });
  const subs: Seen[] = [];
  for (const l of seen.values()) {
    const spot = (x: Seen) => `${x.at}|${x.before}`;
    const where = vote(l, spot).value!;
    const v = { value: '있음', settled: l.length * 2 > N && l.length >= 2, contested: l.length < N && !(l.length * 2 > N) };
    if (v.settled || v.contested) settled['교체'].both++;
    const p = plan[where.at];
    const head = p ? { inn: p.inn, top: p.top, slot: p.slot, title: p.title } : { inn: plan.at(-1)?.inn ?? 1, top: plan.at(-1)?.top ?? true, slot: 0, title: '경기 끝' };
    const name = `${{ PH: '대타', PR: '대주자', DEF: '수비', P: '투수' }[where.e.role]} ${where.e.player.name}`;
    if (v.settled) {
      settled['교체'].agree++;
      for (let r = 0; r < N; r++) { scorers[r].total++; if (l.some((x) => x.r === r)) scorers[r].agree++; }
    } else if (v.contested) disputes.push({ ...head, field: '교체', values: sources.map((s, r) => ({ label: s.label, value: l.some((x) => x.r === r) ? name : '없음' })) });
    // present by agreement, but put in different places
    const place = (x: Seen) => { const q = plan[x.at]; return `${q ? `${q.inn}회${q.top ? '초' : '말'} ${q.title}` : '경기 끝'} ${x.before ? `${x.before}번째 입력 뒤` : '전'}`; };
    if (l.length >= 2 && new Set(l.map(spot)).size > 1) disputes.push({ ...head, field: '교체 위치', values: l.map((x) => ({ label: sources[x.r].label, value: `${name} · ${place(x)}` })) });
    if (l.length * 2 >= N) subs.push(where);
  }
  const subsAt = (at: number, before: number) => subs.filter((x) => x.at === at && x.before === before).map((x) => x.e);

  const edits: ManualEvent[] = [sources[0].edits[0]];
  const landings: LandingEvent[] = [];
  plan.forEach((p, j) => {
    let q = 0, k = 0; // inputs (pitches and runner plays) so far; pitches so far
    edits.push(...subsAt(j, 0));
    for (const e of segs[p.witness.r].pas[p.witness.i]) {
      if (e.kind === 'm.sub') continue;
      if (e.kind === 'm.pitch') {
        const fix = p.patch[k] ?? {}, call = (p.calls[k] ?? e.call) as typeof e.call;
        edits.push({ ...e, call, ...(fix.x != null && { x: +fix.x.toFixed(2), z: +fix.z!.toFixed(2) }), ...(fix.stuff && { stuff: fix.stuff }), ...(fix.speed != null && { speed: fix.speed }) });
        k++;
      } else edits.push(e);
      q++;
      edits.push(...subsAt(j, q));
    }
    // a substitution placed after more inputs than this PA has: at its end
    edits.push(...subs.filter((x) => x.at === j && x.before > q).map((x) => x.e));
    if (p.landing) {
      const pa = j + 1, l = p.landing;
      landings.push({ kind: 'landing.set', pa, x: +l.x.toFixed(2), y: +l.y.toFixed(2), res: l.res, inn: l.inn, batter: l.batter, result: l.result });
      for (const [x, y] of l.path) landings.push({ kind: 'landing.path', pa, x, y });
      if (l.resManual && l.res) landings.push({ kind: 'landing.res', pa, res: l.res, manual: true });
      if (l.traj) landings.push({ kind: 'landing.traj', pa, traj: l.traj });
    }
  });
  edits.push(...subsAt(plan.length, 0));
  return { edits, landings, disputes, settled, scorers, plan: plan.map(({ inn, top, slot }) => ({ inn, top, slot })) };
}

/** Problems in the merged game as replayed: the engine's, and plate appearances that don't come where the plan
 *  put them (inning, half, batting slot). */
export function checkMerged(c: Consensus, game: Game, issues: string[]): string[] {
  const out = [...issues];
  const got = game.pas.map((p) => ({ inn: p.inn, top: p.top, slot: slotOf(game, p) }));
  const off = c.plan.findIndex((x, i) => !got[i] || got[i].inn !== x.inn || got[i].top !== x.top || got[i].slot !== x.slot);
  if (off >= 0) { const x = c.plan[off]; out.push(`${x.inn}회${x.top ? '초' : '말'} ${x.slot}번 타석이 계획한 자리에 오지 않아요`); }
  else if (got.length !== c.plan.length) out.push(`타석 수가 ${got.length}개로 계산돼요 (계획 ${c.plan.length}개)`);
  return out;
}
