import { WORLD_CONFIG } from '../core/config/world';

export const TICK_RATE = 10;
export const DT = 1 / TICK_RATE;
export const planetRadius = WORLD_CONFIG.planetRadius;

export const MAX_FRAME_DT = 0.1;
export const MAX_SIM_STEPS_PER_FRAME = 30;
export const UI_UPDATE_INTERVAL_MS = 250;
export const AUTOSAVE_INTERVAL_MS = 15000;
export const ERROR_REPEAT_LOG_INTERVAL_MS = 5000;
