// Worker (little person) configuration: model dimensions, animation and AI timings.
// Single source of truth for everything the render layer needs.

const DEG = Math.PI / 180;

// Overall multiplier so the person is readable at the default zoom.
// Model height ~0.232 u; at 1.12 the worker stands ~0.26 u tall (was 1.6 / ~0.37 u).
export const WORKER_SCALE = 1.12;

// ----- Planter behaviour timings -----
export const WORKER_MIN_RUN_SECONDS = 3; // must run at least this long before planting
export const WORKER_RUN_SPEED = 0.6; // world units / second along the surface
export const WORKER_PLANT_SECONDS = 5; // kneeling + digging at the plot
export const WORKER_STUCK_SECONDS = 20; // give up, release the reservation, go idle
export const WORKER_IDLE_SECONDS = 0.5; // pause right after spawning
export const WORKER_APPEAR_SECONDS = 0.4; // spawn scale-in duration

// ----- Model dimensions (local space, +Y is up, +Z is forward) -----
export const WORKER_MODEL = {
  totalHeight: 0.23,

  // legs: boxes pivoting at the hip
  legWidth: 0.025,
  legHeight: 0.07,
  legSpacing: 0.014, // x offset of each hip from the centre
  hipY: 0.07,

  // torso: upright capsule (rounded box)
  bodyWidth: 0.07,
  bodyHeight: 0.08,
  bodyCenterY: 0.11,

  // arms: thin capsules pivoting at the shoulder
  armWidth: 0.018,
  armLength: 0.06,
  shoulderY: 0.14,
  shoulderX: 0.044,

  // head
  headRadius: 0.04,
  headY: 0.19,
  eyeRadius: 0.006,
  eyeOffsetX: 0.014,
  eyeOffsetY: 0.008,
  eyeOffsetZ: 0.034,

  // cap (half sphere + brim)
  capRadius: 0.042,
  capHeight: 0.024,
  brimWidth: 0.055,
  brimHeight: 0.008,
  brimDepth: 0.03,
  brimZ: 0.038,

  // shovel held in the right hand (planter)
  shovelStickWidth: 0.01,
  shovelStickLength: 0.12,
  shovelBladeWidth: 0.035,
  shovelBladeHeight: 0.045,
  shovelBladeDepth: 0.008,

  // axe held in the right hand (lumberjack)
  axeHandleWidth: 0.009,
  axeHandleLength: 0.11,
  axeHeadWidth: 0.045,
  axeHeadHeight: 0.026,
  axeHeadDepth: 0.012,

  // backpack (carrier) sits on the back (-Z)
  backpackWidth: 0.052,
  backpackHeight: 0.07,
  backpackDepth: 0.03,
  backpackZ: -0.044,

  // logs carried across the shoulders
  carryLogRadius: 0.011,
  carryLogLength: 0.1,
  carryLogY: 0.2,
  carryLogSpacingZ: 0.023,

  // ground shadow
  shadowRadius: 0.075,
  shadowOpacity: 0.3,
} as const;

// ----- Animation parameters -----
export const WORKER_ANIM = {
  runCycleHz: 8,
  runLegSwing: 35 * DEG,
  runArmSwing: 25 * DEG,
  runBob: 0.01,
  runLean: 10 * DEG,

  plantKneelDrop: 0.04,
  plantLean: 30 * DEG,
  plantDigHz: 2,
  plantArmLift: -1.0,
  plantArmSwing: 0.45,

  chopHz: 1.1,
  chopLean: 12 * DEG,
  chopArmStart: -2.35,
  chopArmSwing: 0.95,

  pickLean: 55 * DEG,
  pickDrop: 0.045,

  carryLean: 8 * DEG,

  idleBreathHz: 0.5,
  idleBreath: 0.02,

  spawnFrom: 0.2,
  dirtCount: 6,
  dirtRadius: 0.006,
  dirtPuffSeconds: 0.4,
} as const;

// ----- Colors -----
export const WORKER_COLORS = {
  planter: 0x2f7bff,
  lumberjack: 0xe53935,
  carrier: 0xf9a825,
  miner: 0x8d6e63,
  prospector: 0x7e57c2,
  engineer: 0x26a69a,
  skin: 0xf2c9a0,
  pants: 0x2b3a55,
  boots: 0x333333,
  cap: 0x1d4ed8,
  capBrim: 0x163fa8,
  lumberjackHat: 0x6d4c2f,
  lumberjackHatBrim: 0x553a22,
  carrierHat: 0xf2b705,
  carrierHatBrim: 0xc99a04,
  backpack: 0x6d4c2f,
  backpackStrap: 0x4e3521,
  axeHead: 0xb0b6ba,
  carryLog: 0x8b5a2b,
  carryLogEnd: 0xd9b37a,
  eyes: 0x111111,
  shovelStick: 0x8b5a2b,
  shovelBlade: 0x9aa0a6,
  shadow: 0x000000,
  dirt: 0x6b4a2f,
} as const;

export function shirtColorFor(role: string): number {
  return (WORKER_COLORS as Record<string, number>)[role] ?? WORKER_COLORS.planter;
}
