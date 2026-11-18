import Decimal from 'break_infinity.js';

const PLANET_RADIUS = 2.5;
export { PLANET_RADIUS };
const planetRadius = PLANET_RADIUS;
export const PLOT_COUNT = 1500;
const treeSpacing = Math.sqrt(4 * Math.PI * planetRadius * planetRadius / PLOT_COUNT);

// Tree dimensions (world units) - single source of truth for tuning
export const TREE_TRUNK_HEIGHT = 0.26;
export const TREE_TRUNK_RADIUS_TOP = 0.035;
export const TREE_TRUNK_RADIUS_BOTTOM = 0.05;
export const TREE_TRUNK_COLOR = 0x7a4a21;
export const TREE_CROWN_RADIUS = 0.145;
export const TREE_CROWN_CENTER_Y = 0.31;
export const TREE_CROWN_SQUASH_Y = 0.92;
export const TREE_SHADOW_RADIUS = 0.16;
export const TREE_SHADOW_LIFT = 0.003;

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
  chopTime: 2,
  walkSpeed: 0.6, // world units per second
  woodPrice: 2,
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
  woodValueBoost: 0.10,
  sellInterval: 4,
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
