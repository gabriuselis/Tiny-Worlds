import type * as THREE from 'three';
import type { GameState } from '../core/state';
import type { SceneAPI } from '../render/scene';
import type { ParticleSystem } from '../render/particles';
import type { FloatingTextPool } from '../render/floaters';
import type { UI } from '../ui/ui';
import type { LayeredProgressionStore } from '../persistence/layeredStore';
import type { Progression } from './progression';
import type { LogPileAffordance } from '../render/affordance';
import { planetRadius } from './constants';

type Verdant = GameState['planets']['verdant'];

// Shared references and loop clock. Fields without a safe default are assigned by
// the init functions called from main.ts, in order, before the loop starts.
export interface AppContext {
  canvas: HTMLCanvasElement;
  sceneAPI: SceneAPI | undefined;
  planetGroup: THREE.Group;
  planetMesh: THREE.Mesh;
  // Measured surface radius of the real planet mesh (used so tree bases sit in the ground).
  surfaceRadius: number;
  grid: any;
  state: GameState;
  progressionStore: LayeredProgressionStore;
  progression: Progression;
  verdant: Verdant;
  particles: ParticleSystem | null;
  floaters: FloatingTextPool | null;
  ui: UI;
  updateGestures: any;
  affordance: LogPileAffordance | null;
  defaultDist: number;
  minDist: number;
  maxDist: number;
  uiNeedsUpdate: boolean;
  uiRenderCount: number;
  frameCount: number;
  lastTime: number;
  accumulator: number;
  isPaused: boolean;
  gameSpeedMult: number;
}

export const ctx = {
  sceneAPI: undefined,
  surfaceRadius: planetRadius,
  particles: null,
  floaters: null,
  affordance: null,
  defaultDist: 10,
  minDist: 2,
  maxDist: 18,
  uiNeedsUpdate: false,
  uiRenderCount: 0,
  frameCount: 0,
  accumulator: 0,
  isPaused: false,
  gameSpeedMult: 1,
} as AppContext;
