// Team rosters gathered from the games already scored: for each team name, its most recent batting order and
// starter, and every batter and pitcher it has used (starters, pinch hitters and runners, relievers), most recent
// first. Nothing is typed in for this: it grows as games are scored.
import type { GameEvent } from './events';
import { resolve, type ManualEvent } from './manual';

export interface Roster {
  team: string;
  /** date of the game the last lineup is from */
  date: string;
  lineup: { name: string; pos: string }[];
  pitcher: string;
  /** names, most recent first; with each batter's latest position */
  batters: { name: string; pos: string }[];
  pitchers: string[];
}

/** names the app fills in for blanks ("청룡3번", "청룡 선발") are not players */
const placeholder = (team: string, name: string) => name === `${team} 선발` || new RegExp(`^${team.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\d+번$`).test(name);

type Sub = ManualEvent & { kind: 'm.sub' };

/** events: all stored events (games in any order); each manual game's setup and substitutions in effect are read */
export function rosters(events: readonly GameEvent[]): Record<string, Roster> {
  const byGame = new Map<string, GameEvent[]>();
  for (const e of events) if (e.kind.startsWith('m.')) byGame.set(e.gameId, [...(byGame.get(e.gameId) ?? []), e]);
  const games = [...byGame.values()].flatMap((evs) => {
    const edits = resolve(evs as unknown as ManualEvent[]);
    const setup = edits.find((e) => e.kind === 'm.setup')?.setup;
    return setup ? [{ setup, at: evs.find((e) => e.kind === 'm.setup')!.at, subs: edits.filter((e): e is Sub => e.kind === 'm.sub') }] : [];
  });
  // newest game first; within a game, later substitutions first
  games.sort((a, b) => b.setup.date.localeCompare(a.setup.date) || b.at - a.at);

  const out: Record<string, Roster> = Object.create(null);
  const addBatter = (r: Roster, p: { name: string; pos: string }) => {
    if (!p.name || placeholder(r.team, p.name)) return;
    const had = r.batters.find((b) => b.name === p.name);
    if (!had) r.batters.push({ name: p.name, pos: p.pos });
    else if (!had.pos) had.pos = p.pos; // a pinch hitter's position, from a game he played in the field
  };
  const addPitcher = (r: Roster, name: string) => { if (name && !placeholder(r.team, name) && !r.pitchers.includes(name)) r.pitchers.push(name); };
  for (const { setup, subs } of games) {
    for (const side of ['away', 'home'] as const) {
      const team = side === 'away' ? setup.awayName : setup.homeName;
      if (team === '원정' || team === '홈') continue; // the names a blank team gets: no team to remember
      const r = (out[team] ??= { team, date: setup.date, lineup: setup[side].map((p) => ({ name: placeholder(team, p.name) ? '' : p.name, pos: p.pos })),
        pitcher: placeholder(team, setup[`${side}Pitcher`].name) ? '' : setup[`${side}Pitcher`].name, batters: [], pitchers: [] });
      for (const e of [...subs].reverse()) {
        if (e.side !== side) continue;
        if (e.role === 'P') addPitcher(r, e.player.name);
        else addBatter(r, { name: e.player.name, pos: e.player.pos }); // a pinch hitter who stayed on carries his position
      }
      setup[side].forEach((p) => addBatter(r, p));
      addPitcher(r, setup[`${side}Pitcher`].name);
    }
  }
  return out;
}
