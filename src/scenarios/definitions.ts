import { SHIP_TYPES } from '../ship/shipTypes';
import { deriveShipType } from '../ship/deriveShipType';
import { lookAtQuat } from '../math/quaternion';
import { FIGHTER_TUNING_ACE, FIGHTER_TUNING_ROOKIE } from '../combat/enemyAI';
import { buildBarrelRollGatePath } from './gatePath';
import type { ScenarioConfig } from './types';

// Half turn rate opponent for the drill — same Gladius stats otherwise, so it feels like a real
// ship, just an easier one to out-turn.
const SLOW_GLADIUS = deriveShipType(SHIP_TYPES[0], { angularScale: 0.5, name: 'Gladius (Drill Target)' });

// Physically slower-turning hull for the rookie fighter, on top of its more hesitant AI tuning
// (FIGHTER_TUNING_ROOKIE) — the combination is what actually sells "still learning to fly".
const ROOKIE_GLADIUS = deriveShipType(SHIP_TYPES[0], { angularScale: 0.65, name: 'Gladius (Rookie Pilot)' });

const FIGHTER_SPAWN_QUAT = lookAtQuat({ x: 0, y: 0, z: -1 }); // nose-in toward the player's spawn for a head-on merge

// 'orbiter'/'drifter' spawns get a fresh randomized flight path immediately on scenario start (see
// scenarios/runtime.ts) — pos/quat here are unused placeholders, same convention as 'chaser' spawns.
const AIM_TRAINING_PLACEHOLDER_POS = { x: 0, y: 0, z: 0 };
const AIM_TRAINING_PLACEHOLDER_QUAT = { x: 0, y: 0, z: 0, w: 1 };

export const SCENARIOS: ScenarioConfig[] = [
  {
    id: 'slow-turret-drill',
    name: 'Slow Turret Drill',
    description:
      'A stationary Gladius with half normal turn rate tracks and fires at you. Land 50 hits to destroy it before it lands 50 on you.',
    enemySpawns: [
      {
        type: SLOW_GLADIUS,
        pos: { x: 400, y: 0, z: 1800 },
        quat: { x: 0, y: 0, z: 0, w: 1 },
        behavior: 'turret',
        turnRateRadPerSec: SLOW_GLADIUS.maxAngVel.yaw
      }
    ],
    hitsToKillEnemy: 50,
    hitsToKillPlayer: 50,
    includeStation: false,
    winCondition: 'destroy'
  },
  {
    id: 'fighter-intercept-rookie',
    name: 'Fighter Intercept — Rookie',
    description:
      'A rookie pilot in a slower-turning Gladius: bails into a wide extend at the first bad angle, needs a clean setup before it dares to shoot, and spooks easily. Land 50 hits to destroy it before it lands 50 on you.',
    enemySpawns: [
      {
        type: ROOKIE_GLADIUS,
        pos: { x: 250, y: 80, z: 2600 },
        quat: FIGHTER_SPAWN_QUAT,
        behavior: 'fighter',
        tuning: FIGHTER_TUNING_ROOKIE
      }
    ],
    hitsToKillEnemy: 50,
    hitsToKillPlayer: 50,
    includeStation: false,
    winCondition: 'destroy'
  },
  {
    id: 'fighter-intercept-ace',
    name: 'Fighter Intercept — Ace',
    description:
      'A full-spec Gladius flown aggressively: fights through bad angles instead of running from them, holds close range for deflection shots, and only breaks off when you actually get guns-on. Land 50 hits to destroy it before it lands 50 on you.',
    enemySpawns: [
      {
        type: SHIP_TYPES[0],
        pos: { x: 250, y: 80, z: 2600 },
        quat: FIGHTER_SPAWN_QUAT,
        behavior: 'fighter',
        tuning: FIGHTER_TUNING_ACE
      }
    ],
    hitsToKillEnemy: 50,
    hitsToKillPlayer: 50,
    includeStation: false,
    winCondition: 'destroy'
  },
  {
    id: 'barrel-roll-escape-turret',
    name: 'Barrel Roll — Escape the Turret (Easy)',
    description:
      'A stationary Gladius turret has you in its sights. Fly the marked gate path — a barrel-roll break — to open distance and clear its firing arc before time runs out.',
    enemySpawns: [
      {
        type: SHIP_TYPES[0],
        pos: { x: 150, y: 0, z: 500 },
        quat: { x: 0, y: 0, z: 0, w: 1 },
        behavior: 'turret',
        turnRateRadPerSec: SHIP_TYPES[0].maxAngVel.yaw
      }
    ],
    hitsToKillEnemy: 30,
    hitsToKillPlayer: 20,
    includeStation: false,
    winCondition: 'gates',
    gatePath: buildBarrelRollGatePath({
      startZ: 250, gateCount: 6, spacingZ: 180, turns: 1, rollRadius: 70, gateRadius: 50
    }),
    surviveDurationSec: 30
  },
  {
    id: 'barrel-roll-evade-chaser',
    name: 'Barrel Roll — Shake a Tail (Medium)',
    description:
      'A Gladius has locked onto your six and won\'t let go. Fly the marked gate path to barrel-roll clear of its guns before it wears you down.',
    enemySpawns: [
      {
        type: SHIP_TYPES[0],
        pos: { x: 0, y: 0, z: -150 },
        quat: { x: 0, y: 0, z: 0, w: 1 },
        behavior: 'chaser'
      }
    ],
    hitsToKillEnemy: 30,
    hitsToKillPlayer: 20,
    includeStation: false,
    winCondition: 'gates',
    gatePath: buildBarrelRollGatePath({
      startZ: 250, gateCount: 8, spacingZ: 150, turns: 1, rollRadius: 90, gateRadius: 38
    }),
    surviveDurationSec: 35
  },
  {
    id: 'aim-training',
    name: 'Aim Training',
    description:
      'A swarm of harmless drones — some circle you, some streak past on random flight lines. ' +
      'Hold position (or move freely) and practice yaw/pitch tracking with ESP engaged. No lose condition — ' +
      'just an accuracy score at the end.',
    enemySpawns: [
      ...Array.from({ length: 4 }, () => ({
        type: SHIP_TYPES[0],
        pos: AIM_TRAINING_PLACEHOLDER_POS,
        quat: AIM_TRAINING_PLACEHOLDER_QUAT,
        behavior: 'orbiter' as const
      })),
      ...Array.from({ length: 4 }, () => ({
        type: SHIP_TYPES[0],
        pos: AIM_TRAINING_PLACEHOLDER_POS,
        quat: AIM_TRAINING_PLACEHOLDER_QUAT,
        behavior: 'drifter' as const
      }))
    ],
    hitsToKillEnemy: 3,
    hitsToKillPlayer: 999, // unreachable — drones never fire, this drill has no lose condition
    includeStation: false,
    winCondition: 'survive',
    surviveDurationSec: 90
  }
];
