// Scorebook notation (6-3, F8, ꓘ, E6, ...) from Naver's Korean PA result text.
import type { Game, PA } from './naver/parse';

export type NoteKind = 'hit' | 'walk' | 'out' | 'er';
export interface Note { c: string; k: NoteKind }

const POS: Record<string, number> = { 투수: 1, 포수: 2, '1루수': 3, '2루수': 4, '3루수': 5, 유격수: 6, 좌익수: 7, 중견수: 8, 우익수: 9 };
const POS_RE = /(투수|포수|1루수|2루수|3루수|유격수|좌익수|중견수|우익수)/g;

/** Strip the "선수명 : " prefix Naver puts on relay lines. */
export const stripName = (t: string) => t.replace(/^[^:]+ : /, '');

export function notation(pa: PA): Note | null {
  const t = stripName(pa.result ?? '');
  if (!t) return null;
  const lastCall = pa.pitches[pa.pitches.length - 1]?.call;
  // a dropped third strike ("포수 스트라이크 낫 아웃 (포수 태그아웃)") is still a strikeout
  if (/삼진|낫 ?아웃/.test(t)) return { c: lastCall === 'T' ? 'ꓘ' : 'K', k: 'out' };
  if (/고의/.test(t)) return { c: 'IBB', k: 'walk' };
  if (/볼넷/.test(t)) return { c: 'BB', k: 'walk' };
  if (/몸에 맞는/.test(t)) return { c: 'HBP', k: 'walk' };
  if (/홈런/.test(t)) return { c: 'HR', k: 'hit' };
  if (/3루타/.test(t)) return { c: '3B', k: 'hit' };
  if (/2루타/.test(t)) return { c: '2B', k: 'hit' };
  if (/1루타|내야안타/.test(t)) return { c: '1B', k: 'hit' };
  const pos0 = t.match(POS_RE)?.[0];
  const first = pos0 ? POS[pos0] : '';
  if (/실책/.test(t)) return { c: 'E' + first, k: 'er' };
  if (/야수선택|땅볼로 출루/.test(t)) return { c: 'FC', k: 'er' };
  const chain = ((t.match(/\(([^)]*)\)/) ?? [])[1]?.match(POS_RE) ?? []).map((p) => POS[p]);
  const nums = (chain.length ? chain : [first]).join('-');
  if (/희생번트/.test(t)) return { c: 'SAC ' + nums, k: 'out' };
  if (/희생플라이/.test(t)) return { c: 'SF' + first, k: 'out' };
  if (/병살/.test(t)) return { c: nums + ' DP', k: 'out' };
  if (/플라이/.test(t)) return { c: 'F' + first, k: 'out' };
  if (/라인드라이브|직선타/.test(t)) return { c: 'L' + first, k: 'out' };
  if (/땅볼|번트/.test(t)) return { c: chain.length > 1 ? nums : first + 'U', k: 'out' };
  return { c: t.slice(0, 5), k: 'out' };
}

/** Names of the players who scored in each half inning ("3t" / "3b"), one entry per run, from "… : 홈인" lines
 *  and home runs. A pinch runner's run is credited to the batter he replaced on base. */
export function runsScored(g: Game): Record<string, string[]> {
  const ranFor: Record<string, string> = {};
  for (const pa of g.pas)
    for (const e of pa.events) {
      const m = e.match(/(\S+) : 대주자 (\S+) \(으\)로 교체/);
      if (m) ranFor[m[2]] = m[1];
    }
  const origin = (n: string) => { while (ranFor[n]) n = ranFor[n]; return n; };
  const scored: Record<string, string[]> = {};
  for (const pa of g.pas) {
    const runs = (scored[pa.inn + (pa.top ? 't' : 'b')] ??= []);
    for (const e of pa.events) {
      // "3루주자 X : 홈인", also with a cause ("… : 폭투로 홈인") and a note ("… : 실책으로 홈인 (2루수 송구 실책->1루수)")
      const m = e.match(/(\S+) : (?:\S+ )?홈인(?: \(.*\))?$/);
      if (m) runs.push(origin(m[1]));
    }
    if (/홈런/.test(pa.result ?? '')) runs.push(g.names[pa.batter]);
  }
  return scored;
}
