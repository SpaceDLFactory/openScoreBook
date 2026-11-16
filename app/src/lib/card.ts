// Score card: a 1200x630 SVG of one game (date, park, teams, score, line score), for link previews and sharing.
// Pure string building, no DOM, so a server can make the same card (SVG to PNG there; it needs a Korean font).
import type { Game } from './naver/parse';
import type { Now } from './manual';

export interface CardSummary {
  date: string; stadium: string;
  away: string; home: string;
  score: [number, number];
  /** runs per inning, as the line score shows them ('' or missing: not played) */
  innings: { away: string[]; home: string[] };
  status: 'final' | 'live';
  inning: number; top: boolean;
}

/** Is a manually scored game over, from where it stands? The home side leading in the bottom of the 9th or later
 *  (it doesn't bat, or just walked off), or the visitors leading as an extra half would start. */
export function isOver(now: Pick<Now, 'inning' | 'top' | 'outs' | 'balls' | 'strikes' | 'awayScore' | 'homeScore'>): boolean {
  if (!now.top && now.inning >= 9 && now.homeScore > now.awayScore) return true;
  return now.top && now.inning >= 10 && now.outs === 0 && now.balls === 0 && now.strikes === 0 && now.awayScore !== now.homeScore;
}

export function summaryOf(game: Game, now: Now): CardSummary {
  const n = Math.max(9, ...['away', 'home'].flatMap((s) => Object.keys(game.inningScore[s as 'away' | 'home']).map(Number)));
  const row = (s: 'away' | 'home') => Array.from({ length: n }, (_, i) => game.inningScore[s][String(i + 1)] ?? '');
  return {
    date: game.meta?.gameDate ?? '', stadium: game.stadium ?? '', away: game.awayName, home: game.homeName,
    score: [now.awayScore, now.homeScore], innings: { away: row('away'), home: row('home') },
    status: isOver(now) ? 'final' : 'live', inning: now.inning, top: now.top,
  };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
/** a name fitted to a width: smaller type for longer names, cut with … past what fits even then */
function fit(name: string, width: number, max: number, min: number): { text: string; size: number } {
  const chars = [...name], w = (c: string) => (/[\u1100-\uffff]/.test(c) ? 1 : 0.6);
  const units = chars.reduce((t, c) => t + w(c), 0);
  const size = Math.max(min, Math.min(max, Math.floor(width / Math.max(units, 1))));
  const room = Math.floor(width / size);
  if (units <= room) return { text: name, size };
  // one pass: as many characters as fit with room left for the ellipsis
  let u = 1, n = 0;
  while (n < chars.length && u + w(chars[n]) <= room) u += w(chars[n++]);
  return { text: chars.slice(0, Math.max(1, n)).join('') + '…', size };
}

export const CARD_FONT = "'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif";

export function cardSvg(s: CardSummary): string {
  const W = 1200, H = 630;
  const [a, h] = s.score;
  const final = s.status === 'final';
  const lead = a === h ? null : a > h ? 'away' : 'home';
  const status = final ? '경기 종료' : `${s.inning}회${s.top ? '초' : '말'} 진행 중`;
  const team = (side: 'away' | 'home', x: number, anchor: string) => {
    const f = fit(side === 'away' ? s.away : s.home, 330, 76, 40);
    const won = final && lead === side;
    return `<text x="${x}" y="292" font-size="${f.size}" font-weight="800" text-anchor="${anchor}" fill="${won ? '#7ee2a4' : '#e6edf3'}">${esc(f.text)}</text>
  <text x="${x}" y="336" font-size="22" font-weight="600" text-anchor="${anchor}" fill="#5c6672">${side === 'away' ? '원정' : '홈'}</text>`;
  };
  // line score: as many innings as were played, at least 9
  const n = Math.max(9, s.innings.away.length, s.innings.home.length);
  const cw = Math.min(64, Math.floor(820 / (n + 1))), x0 = 600 - ((n + 1) * cw + 150) / 2 + 150;
  const cell = (x: number, y: number, t: string, fill = '#aab4c0', weight = 600) =>
    `<text x="${x}" y="${y}" font-size="24" font-weight="${weight}" text-anchor="middle" fill="${fill}">${esc(t)}</text>`;
  const rows = [
    ...Array.from({ length: n }, (_, i) => cell(x0 + i * cw + cw / 2, 452, String(i + 1), '#5c6672')),
    cell(x0 + n * cw + cw / 2, 452, 'R', '#5c6672', 800),
    ...(['away', 'home'] as const).flatMap((side, r) => {
      const y = 500 + r * 46, name = fit(side === 'away' ? s.away : s.home, 140, 24, 18);
      return [
        `<text x="${x0 - 24}" y="${y}" font-size="${name.size}" font-weight="700" text-anchor="end" fill="#e6edf3">${esc(name.text)}</text>`,
        // the home side's last half not batted because it had already won: X, as line scores show it
        ...Array.from({ length: n }, (_, i) => cell(x0 + i * cw + cw / 2, y,
          s.innings[side][i] || (final && side === 'home' && lead === 'home' && i === n - 1 ? 'X' : ''))),
        cell(x0 + n * cw + cw / 2, y, String(side === 'away' ? a : h), '#e6edf3', 800),
      ];
    }),
  ];
  const meta = [s.date, s.stadium].filter(Boolean).join(' · ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${CARD_FONT}">
  <rect width="${W}" height="${H}" fill="#0d1014"/>
  <rect x="0" y="0" width="${W}" height="6" fill="#22c55e"/>
  <text x="64" y="92" font-size="30" font-weight="800" fill="#e6edf3">openScoreBook</text>
  <text x="${W - 64}" y="92" font-size="26" font-weight="600" text-anchor="end" fill="#8b95a3">${esc(meta)}</text>
  ${team('away', 64, 'start')}
  ${team('home', W - 64, 'end')}
  <text x="600" y="300" font-size="132" font-weight="800" text-anchor="middle" fill="#e6edf3" letter-spacing="4">${a} : ${h}</text>
  <rect x="${600 - 86}" y="326" width="172" height="40" rx="20" fill="${final ? 'rgba(34,197,94,.14)' : 'rgba(239,68,68,.14)'}" stroke="${final ? '#22c55e' : '#ef4444'}"/>
  <text x="600" y="354" font-size="20" font-weight="700" text-anchor="middle" fill="${final ? '#7ee2a4' : '#fca5a5'}">${esc(status)}</text>
  <rect x="40" y="408" width="${W - 80}" height="168" rx="18" fill="#161b22" stroke="#2b3440"/>
  ${rows.join('\n  ')}
</svg>`;
}
