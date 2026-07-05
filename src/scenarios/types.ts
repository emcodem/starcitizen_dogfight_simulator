import type { Quat, ShipType, Vec3, EnemyShip, EnemyBehavior, FighterTuning } from '../types';

export interface EnemySpawnConfig {
  type: ShipType;
  pos: Vec3;
  quat: Quat;
  behavior: EnemyBehavior;
  turnRateRadPerSec?: number; // required in practice for 'turret' spawns, unused for 'fighter'
  tuning?: FighterTuning;     // 'fighter' only — a FIGHTER_TUNING_* preset (see combat/enemyAI.ts)
  initialVel?: Vec3;          // 'cruiser' only — its fixed flight velocity for the whole scenario; omitted means {0,0,0}
}

// A single "fly through this ring" waypoint in a scripted gate path (see scenarios/gatePath.ts).
// `quat`'s forward axis is the intended direction of travel through the ring — used both to draw
// it facing the right way and to detect when the player has crossed its plane.
export interface FlightGate {
  pos: Vec3;
  quat: Quat;
  radius: number;
}

// Data-driven scenario definition — adding a new scenario is a new entry in definitions.ts, not
// new engine code (see runtime.ts, which is generic over any config shaped like this).
export interface ScenarioConfig {
  id: string;
  name: string;
  description: string;
  enemySpawns: EnemySpawnConfig[];
  hitsToKillEnemy: number;
  hitsToKillPlayer: number;
  includeStation: boolean; // whether the sandbox station hazard is present during this scenario
  // 'destroy' — the original win condition, land hitsToKillEnemy hits before taking hitsToKillPlayer.
  // 'gates' — evasion drills: win by clearing every gatePath entry in order before surviveDurationSec
  // runs out (or before flying past one outside its ring, which is an immediate loss).
  // 'survive' — Aim Training: no fail state, just wins once surviveDurationSec of elapsed time passes.
  winCondition: 'destroy' | 'gates' | 'survive';
  gatePath?: FlightGate[];       // 'gates' only
  // 'gates' (time limit): required. 'survive' (drill length): omitted means no time limit at all —
  // the drill just runs until the player backs out to the menu (see runtime.ts's win-condition check).
  surviveDurationSec?: number;
  // 0..1 practice-drill difficulty knob for 'orbiter'/'drifter' spawns — scales their flight speed
  // (and, for drifters, how close their flight line passes) via enemyAI.ts's spawnOrbitState/
  // spawnDriftState. Unused outside the Aim Training drill. Defaults to 0.5 when omitted.
  droneAggressiveness?: number;
  // Player's world-space velocity at scenario start — lets a drill spawn the player already moving
  // (e.g. closing head-on with a 'cruiser' target), instead of always starting from a dead stop.
  // Omitted means {0,0,0}, the prior default for every other scenario.
  playerInitialVel?: Vec3;
  // Meters — when set, render.ts draws a wireframe "range bubble" of this radius around every live
  // enemy, e.g. to mark a merge drill's hold-station envelope. Omitted draws nothing.
  rangeBubbleRadius?: number;
}

// A brief visual burst at an enemy's position when it's destroyed — see ENEMY_EXPLOSION_DURATION
// in runtime.ts and drawEnemyExplosions in render.ts.
export interface EnemyExplosion {
  pos: Vec3;
  timer: number; // seconds remaining, counts down to 0
}

export interface ScenarioRuntime {
  config: ScenarioConfig;
  enemies: EnemyShip[];
  outcome: 'active' | 'won' | 'lost';
  failReason?: 'died' | 'missedGate' | 'timeout'; // set alongside outcome === 'lost'
  elapsedSec: number;
  gateIndex: number; // index of the next uncleared gate in config.gatePath — 'gates' scenarios only
  stats: { shotsFired: number; hitsLanded: number; kills: number }; // accuracy/kill tracking, shown live (Aim Training HUD) and on the results screen
  explosions: EnemyExplosion[]; // active death-effect bursts, pruned as their timers expire
  // Total seconds the player has spent within any live enemy's rangeBubbleRadius (Merge Drill) —
  // accumulated every tick in scenarios/runtime.ts, unused/always 0 for configs without a bubble.
  // Displayed as a "ticks" count (see bubbleTicks in runtime.ts) that rises by 1 every 100ms inside.
  bubbleTimeSec: number;
}
