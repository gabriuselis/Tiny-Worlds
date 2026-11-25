import Decimal from 'break_infinity.js';
import { toMoney } from './money';

export type PlanetId = 'verdant' | 'rocky' | 'crystalis' | 'forge' | 'hub';
export type Role = 'planter' | 'lumberjack' | 'carrier' | 'miner' | 'prospector' | 'engineer';
export type ResourceId = 'wood' | 'stone' | 'ore' | 'crystal' | 'planks' | 'bricks' | 'parts';
export type UpgradeId = 'planter' | 'lumberjack' | 'carrier' | 'plantSpeed' | 'chopSpeed' | 'woodValue' | 'tapPower' | 'maxTrees';
export type PerkId = 'offlineCap' | 'startWorkers' | 'unlockEarly' | 'autoBuy';
export type BlessingId = 'woodValue' | 'planters' | 'lumberjacks' | 'carrierSpeed' | 'carriers' | 'woodValue2';

export type Vec3 = { x: number; y: number; z: number };

export type NodeStage = 'sapling' | 'growing' | 'ready' | 'depleted';

export type PlotStage = 'empty' | 'sapling' | 'medium' | 'grown' | 'falling' | 'logs';

export type WorkerState =
  | 'idle'
  | 'dropping'
  | 'walk'
  | 'walkToPost'
  | 'walking'
  | 'planting'
  | 'plant'
  | 'chop'
  | 'chopping'
  | 'pickup'
  | 'picking'
  | 'carrying'
  | 'delivering'
  | 'deliver'
  | 'waiting'
  | 'wander';

export interface Node {
  id: number;
  type: 'tree' | 'rock' | 'crystal';
  pos: Vec3;
  stage: NodeStage;
  timer: number;
  reservedBy?: number;
  resourceType?: ResourceId;
}

export interface Plot {
  id: number;
  dir: Vec3;
  state: PlotStage;
  timer: number;
  reservedBy?: number; // worker id
  woodLeft?: number; // logs remaining on a 'logs' pile (0..3)
  fallDir?: Vec3; // tangent direction the tree falls toward
  popTimer?: number; // visual pop scale boost when a growth stage changes
  collectQueue?: number; // number of logs queued for carrier pickup
  collectTimer?: number; // seconds until next log can be picked up
  beingCollected?: boolean; // true while a worker/player is actively taking a log
}

export interface Worker {
  id: number;
  role: Role;
  pos: Vec3;
  state: WorkerState;
  target?: number; // plot id or -1 for post
  carrying?: { res: ResourceId; amt: number };
  level: number;
  cosmetic: { hat: string; color: string };
  name: string;
  stuckTimer: number;
  dropProgress?: number; // 0..1 sky-drop animation
  plantTimer?: number; // planter: seconds left in planting animation
  appearTimer?: number; // planter: spawn pop-in seconds left
  stateTimer?: number; // planter: seconds left in the current AI state (debug)
  chopTimer?: number; // lumberjack: seconds left chopping
  actionTimer?: number; // carrier: pickup / delivery seconds left
  carryingLogs?: number; // carrier/self-haul: logs currently held (0..3)
  standDir?: Vec3; // AI: direction of the standing spot beside the target
}

export interface PlanetState {
  unlocked: boolean;
  resources: Record<ResourceId, Decimal>;
  plots: Plot[];
  workers: Worker[];
  buildings: Record<string, number>;
  treesHarvested: number;
  toolsCrafted: number;
  usablePlotCount: number;
}

export interface QuestState {
  id: string;
  completed: boolean;
  claimed: boolean;
  progress: number;
  target: number;
}

export interface PrestigeState {
  count: number;
  starDust: Decimal;
  perks: Record<PerkId, number>;
}

export interface GameState {
  version: number;
  lastSaved: number;
  currencies: { credits: Decimal; gems: number; starDust: Decimal };
  /** Cumulative visible wood collected (only ever goes up). */
  wood: Decimal;
  /** Logs waiting to be sold at the trade post. */
  woodToSell: Decimal;
  /** Total wood spent on blessings (only ever goes up). */
  woodSpent: Decimal;
  /** Simulation clock in seconds (drives the rolling Wood/min window). */
  simSeconds: number;
  /** Timestamps (simSeconds) of the last logs taken, pruned to 60 s. */
  woodLogTimes: number[];
  planets: Record<PlanetId, PlanetState>;
  upgrades: Record<UpgradeId, number>;
  /** Owned blessing IDs (each can be bought once). */
  blessings: BlessingId[];
  prestige: PrestigeState;
  quests: QuestState[];
  stats: { treesPlanted: number; woodSold: Decimal; lifetimeCredits: Decimal };
  settings: { sound: boolean; quality: 'low' | 'med' | 'high' };
}

export const SAVE_VERSION = 5;
export const MIN_SUPPORTED_SAVE_VERSION = 3;

export function initialState(nowMs = 0): GameState {
  const zero = new Decimal(0);
  return {
    version: SAVE_VERSION,
    lastSaved: nowMs,
    currencies: { credits: toMoney(100), gems: 0, starDust: zero },
    wood: zero,
    woodToSell: zero,
    woodSpent: zero,
    simSeconds: 0,
    woodLogTimes: [],
    planets: {
      verdant: {
        unlocked: true,
        resources: { wood: zero, stone: zero, ore: zero, crystal: zero, planks: zero, bricks: zero, parts: zero },
        plots: [],
        workers: [],
        buildings: {},
        treesHarvested: 0,
        toolsCrafted: 0,
        usablePlotCount: 0,
      },
      rocky: { unlocked: false, resources: { wood: zero, stone: zero, ore: zero, crystal: zero, planks: zero, bricks: zero, parts: zero }, plots: [], workers: [], buildings: {}, treesHarvested: 0, toolsCrafted: 0, usablePlotCount: 0 },
      crystalis: { unlocked: false, resources: { wood: zero, stone: zero, ore: zero, crystal: zero, planks: zero, bricks: zero, parts: zero }, plots: [], workers: [], buildings: {}, treesHarvested: 0, toolsCrafted: 0, usablePlotCount: 0 },
      forge: { unlocked: false, resources: { wood: zero, stone: zero, ore: zero, crystal: zero, planks: zero, bricks: zero, parts: zero }, plots: [], workers: [], buildings: {}, treesHarvested: 0, toolsCrafted: 0, usablePlotCount: 0 },
      hub: { unlocked: false, resources: { wood: zero, stone: zero, ore: zero, crystal: zero, planks: zero, bricks: zero, parts: zero }, plots: [], workers: [], buildings: {}, treesHarvested: 0, toolsCrafted: 0, usablePlotCount: 0 },
    },
    upgrades: { planter: 0, lumberjack: 0, carrier: 0, plantSpeed: 0, chopSpeed: 0, woodValue: 0, tapPower: 0, maxTrees: 0 },
    blessings: [],
    prestige: { count: 0, starDust: zero, perks: { offlineCap: 0, startWorkers: 0, unlockEarly: 0, autoBuy: 0 } },
    quests: [],
    stats: { treesPlanted: 0, woodSold: zero, lifetimeCredits: zero },
    settings: { sound: true, quality: 'med' },
  };
}

export const INITIAL_PLANTER = 'planter';

