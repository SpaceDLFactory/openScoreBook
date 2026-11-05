// The Rust scoring engine (../engine, built to src/engine with `npm run engine`), JSON in / JSON out.
import init, { deriveJson } from '../engine/engine.js';

export type PaResultType =
  | 'Single' | 'Double' | 'Triple' | 'HomeRun' | 'Walk' | 'HitByPitch' | 'Strikeout'
  | 'GroundOut' | 'FlyOut' | 'DoublePlay' | 'FieldersChoice' | 'Error' | 'SacFly' | 'SacBunt';
export type Spot = 'Batter' | 'First' | 'Second' | 'Third' | 'Home' | 'Out';
export interface Advance { from: Spot; to: Spot }
export type EngineEvent =
  | { kind: 'PlateAppearance'; result: { type: PaResultType }; advances?: Advance[] }
  | { kind: 'Runners'; advances: Advance[] };
export interface EngineConfig { away: string[]; home: string[] }

export interface BatLine { ab: number; r: number; h: number; rbi: number; bb: number; so: number }
export interface Derived {
  state: {
    inning: number; half: 'Top' | 'Bottom'; outs: number;
    away_score: number; home_score: number;
    linescore: { inning: number; half: 'Top' | 'Bottom'; runs: number }[];
  };
  away_box: BatLine[];
  home_box: BatLine[];
}

let ready: Promise<unknown> | null = null;
/** Load the wasm once. In node (tests) pass the module bytes; the browser fetches it next to the glue. */
export const loadEngine = (wasm?: BufferSource) => (ready ??= init(wasm ? { module_or_path: wasm } : undefined));

export async function derive(config: EngineConfig, events: EngineEvent[]): Promise<Derived> {
  await loadEngine();
  return JSON.parse(deriveJson(JSON.stringify(config), JSON.stringify(events)));
}
