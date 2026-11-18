// Worker (little person) configuration: model dimensions, animation and AI timings.
// Single source of truth for everything the render layer needs.

const DEG = Math.PI / 180;

// Overall multiplier so the person is readable at the default zoom.
// 1.6 makes the ~0.23 u tall model ~0.37 u tall (tree is ~0.46 u).
export const WORKER_SCALE = 1.6;

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

  // shovel held in the right hand
  shovelStickWidth: 0.01,
  shovelStickLength: 0.12,
  shovelBladeWidth: 0.035,
  shovelBladeHeight: 0.045,
  shovelBladeDepth: 0.008,

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
  eyes: 0x111111,
  shovelStick: 0x8b5a2b,
  shovelBlade: 0x9aa0a6,
  shadow: 0x000000,
  dirt: 0x6b4a2f,
} as const;

export function shirtColorFor(role: string): number {
  return (WORKER_COLORS as Record<string, number>)[role] ?? WORKER_COLORS.planter;
}
