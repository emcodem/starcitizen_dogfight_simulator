import type { Quat, ShipType, Vec3, EnemyShip } from '../types';

export interface EnemySpawnConfig {
  type: ShipType;
  pos: Vec3;
  quat: Quat;
  turnRateRadPerSec: number;
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
}

export interface ScenarioRuntime {
  config: ScenarioConfig;
  enemies: EnemyShip[];
  outcome: 'active' | 'won' | 'lost';
}
