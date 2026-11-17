import Decimal from 'break_infinity.js';

const planetRadius = 2.5;
const treeSpacing = 0.32;

export const WORLD_CONFIG = {
  planetRadius,
  treeSpacing,
  usableStart: 120,
  treeHeight: 0.30,
  treeCrownRadius: 0.11,
  treeTrunkRadius: 0.012,
  workerHeight: 0.12,
  grassTuftCount: 2000,
  flowerCount: 120,
  // Growth times (seconds)
  growTimeSmall: 6,   // sapling -> medium
  growTimeMedium: 6,  // medium -> grown
  plantTime: 1.2,
  chopTime: 2,
  walkSpeed: 0.5, // world units per second
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
