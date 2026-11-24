import { describe, it, expect } from 'vitest';
import { initCameraDistances } from '../src/app/camera';
import { ctx } from '../src/app/context';
import { planetRadius } from '../src/app/constants';
import { WORLD_CONFIG } from '../src/core/config/world';

const FOV = 45 * (Math.PI / 180);
const SCREEN_PADDING = 0.85;
const fitDist = (planetRadius * 2) / (2 * Math.tan(FOV / 2) * SCREEN_PADDING);
const oldMax = fitDist * WORLD_CONFIG.zoomMaxMultiplier;

describe('camera distances', () => {
  it('start = old max, new max = 1.8 x old max, min unchanged', () => {
    initCameraDistances();
    expect(ctx.minDist).toBe(planetRadius + WORLD_CONFIG.zoomMinAboveSurface);
    expect(ctx.defaultDist).toBe(oldMax);
    expect(ctx.maxDist).toBe(oldMax * WORLD_CONFIG.zoomMaxMultiplier);
  });
});
