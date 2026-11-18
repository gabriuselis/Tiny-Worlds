import Decimal from 'break_infinity.js';

const PLANET_RADIUS = 2.5;
export { PLANET_RADIUS };
const planetRadius = PLANET_RADIUS;
export const PLOT_COUNT = 1500;
const treeSpacing = Math.sqrt(4 * Math.PI * planetRadius * planetRadius / PLOT_COUNT);

// Tree dimensions (world units) - single source of truth for tuning
export const TREE_TRUNK_HEIGHT = 0.34;
export const TREE_TRUNK_RADIUS_TOP = 0.036;
export const TREE_TRUNK_RADIUS_BOTTOM = 0.054;
export const TREE_TRUNK_COLOR = 0x6b4423;
export const TREE_ROOT_FLARE_RADIUS = 0.07;
export const TREE_ROOT_FLARE_HEIGHT = 0.045;
export const TREE_ROOT_MOUND_RADIUS = 0.085;
export const TREE_ROOT_MOUND_COLOR = 0x5b3a20;
export const TREE_ROOT_MOUND_LIFT = 0.001; // slight lift above the plot base to avoid z-fighting
export const TREE_CROWN_RADIUS = 0.145;
export const TREE_CROWN_CENTER_Y = 0.41;
export const TREE_CROWN_SQUASH_Y = 0.92;
export const TREE_SHADOW_RADIUS = 0.16;
export const TREE_SHADOW_LIFT = 0.003;
// Total standing height of a full-grown tree (~0.543 world units).
export const TREE_TOTAL_HEIGHT = TREE_CROWN_CENTER_Y + TREE_CROWN_RADIUS * TREE_CROWN_SQUASH_Y;

// Log pile (the little ðŸªµ pyramid on a chopped plot)
export const LOG_RADIUS = 0.028;
export const LOG_LENGTH = 0.17;
export const LOG_BODY_COLOR = 0x7a4e26;
export const LOG_END_COLOR = 0xd9b37a;
export const LOG_BOTTOM_Y = 0.028;
export const LOG_BOTTOM_OFFSET_Z = 0.032;
export const LOG_TOP_Y = 0.028 + 0.049;
export const LOG_PILE_CAPACITY = PLOT_COUNT * 3; // 3 logs per plot
export const LOG_LOGS_PER_PILE = 3;
export const LOG_YAW_JITTER = (4 * Math.PI) / 180;

// Selling: each log taken is worth WOOD_PRICE credits at delivery.
export const WOOD_PRICE = 2;

// Trade post is at the north pole of the verdant planet.
export const TRADE_POST_DIR = { x: 0, y: 1, z: 0 } as const;

// Tree growth: small (0.35) -> medium (0.65) -> grown (1.0) over 2 minutes.
export const GROW_STAGE_SECONDS = [60, 60] as const;
export const GROW_TOTAL_SECONDS = GROW_STAGE_SECONDS[0] + GROW_STAGE_SECONDS[1];
export const GROW_POP_SECONDS = 0.35;

export const WORLD_CONFIG = {
  planetRadius,
  treeSpacing,
  plotCount: PLOT_COUNT,
  usableStart: 120,
  treeHeight: 0.30,
  treeCrownRadius: 0.11,
  treeTrunkRadius: 0.012,
  workerHeight: 0.12,
  // Growth times (seconds): sapling -> medium -> grown, 2 minutes total
  growTimeSmall: GROW_STAGE_SECONDS[0],
  growTimeMedium: GROW_STAGE_SECONDS[1],
  plantTime: 5,
  chopTime: 4,
  fallTime: 0.8,
  fallShrinkTime: 0.3,
  pickupTime: 1.5,
  carryCapacity: 3,
  carrySpeedFactor: 0.7,
  lumberjackSelfHaul: true,
  lumberjackRetry: 1,
  standingOffset: 0.22, // world units beside the tree base
  chopMaxDistance: 0.35, // world units from the tree base while chopping
  maxFallingTrees: 40,
  walkSpeed: 0.6, // world units per second
  logPickupTime: 1,
  stumpDecayTime: 30,
  costs: {
    hirePlanter: new Decimal(10),
    hireLumberjack: new Decimal(12),
    hireCarrier: new Decimal(100),
    plantSpeed: new Decimal(25),
    chopSpeed: new Decimal(25),
    woodValue: new Decimal(25),
    maxTrees: new Decimal(50),
  },
  costGrowth: 1.25,
  speedReduction: 0.08,
  startCredits: 10,
  startPlanter: 1,
  startLumberjack: 1,
  startHalfGrownSaplings: 5,
  goalTrees: 500,
  maxTreesSlotsPerLevel: 40,
  zoomMinAboveSurface: 0.8,
  zoomMaxMultiplier: 1.8,
  dragSensitivityK: 0.005,
  // Worker sky-drop
  dropFlightTime: 0.9,
  dropStartScale: 0.25,
  dropStartDistFactor: 0.4, // fraction of camera distance
};

