export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface AngularState {
  pitch: number;
  yaw: number;
  roll: number;
}

export interface ShipType {
  name: string;
  mass: number;    // gameplay-tuning mass, used as rotational inertia too — see physics/step.ts
  massKg: number;  // real-world reference mass in kg, informational only — not yet used by
                   // physics (no established conversion from this to the tuning `mass` above)
  linearThrust: { main: number; retro: number; strafe: number; vertical: number };
  angularThrust: AngularState;      // == maxAngVel * angularDrag per axis — see shipTypes.ts
  linearDrag: number;
  angularDrag: number;
  maxAngVel: AngularState;
  scmSpeed: number;                 // coupled-mode speed cap, forward (local +Z velocity)
  scmSpeedBack: number;             // coupled-mode speed cap, backward (local -Z velocity)
  boostSpeedForward: number;        // coupled-mode speed cap while boosting, forward
  boostSpeedBack: number;           // coupled-mode speed cap while boosting, backward
  boostCapacity: number;            // seconds of boost available from a full meter
  boostRechargeRate: number;        // meter-seconds recovered per real second while not boosting
  boostMaxAngVel: AngularState;     // rotation-rate cap while boosting
  boostAngularThrust: AngularState; // == boostMaxAngVel * angularDrag per axis — same derivation as angularThrust
}

export interface Ship {
  type: ShipType;
  pos: Vec3;
  vel: Vec3;
  quat: Quat;
  angVel: AngularState;
  throttle: number; // -1..1, main/retro thrust intent
  decoupled: boolean;
  spaceBrakeOn: boolean;
  boostMeter: number; // seconds of boost remaining, 0..type.boostCapacity
  boosting: boolean;  // whether boost is actually in effect this frame (requested AND meter > 0)
  exploding: boolean;
  explosionTimer: number;
}

export type ActionName =
  | 'pitchUp' | 'pitchDown'
  | 'yawLeft' | 'yawRight'
  | 'rollLeft' | 'rollRight'
  | 'strafeForward' | 'strafeBack'
  | 'strafeLeft' | 'strafeRight'
  | 'strafeUp' | 'strafeDown'
  | 'decoupleToggle' | 'spaceBrake' | 'boost';

export type KeyChord = string[]; // KeyboardEvent.code values, ANDed together
export type KeyBindings = Record<ActionName, KeyChord[]>;

export type AxisConcept =
  | 'pitch' | 'yaw' | 'roll'
  | 'strafeLateral' | 'strafeVertical' | 'strafeLongitudinal';

// Resolved from an imported actionmaps.xml: instance -> device -> best-effort letter-to-index guess
export interface XmlAxisBinding {
  instance: string;
  axis: string;
  scName: string;
  manual?: false;
}

// Captured live by wiggling a stick — exact vid/pid/array-index, no guessing
export interface ManualAxisBinding {
  vid: string;
  pid: string;
  axisIndex: number;
  label: string;
  manual: true;
}

export type AxisBinding = XmlAxisBinding | ManualAxisBinding;
export type AxisMap = Partial<Record<AxisConcept, AxisBinding>>;

export interface ButtonBinding {
  vid: string;
  pid: string;
  buttonIndex: number;
  label: string;
}
export type ButtonMap = Partial<Record<ActionName, ButtonBinding>>;

export interface ScDevice {
  instance: string;
  name: string;
  guid: string | null;
  vid: string | null;
  pid: string | null;
}

export interface GamepadSnapshot {
  index: number;
  id: string;
  axesValues: number[];
  buttonsPressed: boolean[];
  vid: string | null;
  pid: string | null;
}

export interface Projectile {
  pos: Vec3;
  vel: Vec3;
  age: number;
}

export interface StickAxes {
  lateral: number | null;
  vertical: number | null;
  longitudinal: number | null;
  pitch: number | null;
  yaw: number | null;
  roll: number | null;
}
