import type { Quat, ShipType, Vec3, EnemyShip, EnemyBehavior, FighterTuning } from '../types';

export interface EnemySpawnConfig {
  type: ShipType;
  pos: Vec3;
  quat: Quat;
  behavior: EnemyBehavior;
  turnRateRadPerSec?: number; // required in practice for 'turret' spawns, unused for 'fighter'
  tuning?: FighterTuning;     // 'fighter' only — a FIGHTER_TUNING_* preset (see combat/enemyAI.ts)
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
  surviveDurationSec?: number;   // 'gates' (time limit) and 'survive' (drill length) only
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
  stats: { shotsFired: number; hitsLanded: number }; // accuracy tracking, shown on the results screen
  explosions: EnemyExplosion[]; // active death-effect bursts, pruned as their timers expire
}
