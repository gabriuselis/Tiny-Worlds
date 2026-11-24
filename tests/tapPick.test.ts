import { describe, it, expect } from 'vitest';
import {
  pickNearestPile,
  isTapGesture,
  TAP_PICK_RADIUS_PX,
  TAP_MOVE_TOLERANCE_PX,
  type ScreenPile,
} from '../src/render/tapPick';

describe('pickNearestPile', () => {
  it('picks the nearest pile within the tap radius', () => {
    const piles: ScreenPile[] = [
      { id: 1, x: 135, y: 100, visible: true }, // 35 px away
      { id: 2, x: 120, y: 100, visible: true }, // 20 px away
      { id: 3, x: 108, y: 100, visible: true }, // 8 px away -> nearest
    ];
    const hit = pickNearestPile(piles, 100, 100);
    expect(hit?.id).toBe(3);
  });

  it('ignores a pile behind the planet (visible = false)', () => {
    const piles: ScreenPile[] = [
      { id: 1, x: 100, y: 100, visible: false }, // on the far side
      { id: 2, x: 160, y: 100, visible: true }, // outside radius
    ];
    expect(pickNearestPile(piles, 100, 100)).toBeNull();
  });

  it('returns null when the tap hits no pile', () => {
    const piles: ScreenPile[] = [{ id: 1, x: 0, y: 0, visible: true }];
    expect(pickNearestPile(piles, 500, 500)).toBeNull();
  });

  it('respects the ~40 px radius boundary', () => {
    const piles: ScreenPile[] = [{ id: 1, x: TAP_PICK_RADIUS_PX, y: 0, visible: true }];
    expect(pickNearestPile(piles, 0, 0)?.id).toBe(1);
    const far: ScreenPile[] = [{ id: 2, x: TAP_PICK_RADIUS_PX + 1, y: 0, visible: true }];
    expect(pickNearestPile(far, 0, 0)).toBeNull();
  });
});

describe('isTapGesture', () => {
  const base = { downX: 0, downY: 0, upX: 0, upY: 0, downTime: 0, upTime: 100, multiTouch: false };

  it('treats a still, short, single-finger press as a tap', () => {
    expect(isTapGesture(base)).toBe(true);
  });

  it('rejects a drag over the 8 px tolerance', () => {
    expect(isTapGesture({ ...base, upX: TAP_MOVE_TOLERANCE_PX + 1 })).toBe(false);
    expect(isTapGesture({ ...base, upY: TAP_MOVE_TOLERANCE_PX + 1 })).toBe(false);
    expect(isTapGesture({ ...base, upX: TAP_MOVE_TOLERANCE_PX })).toBe(true);
  });

  it('rejects a pinch / two-finger gesture', () => {
    expect(isTapGesture({ ...base, multiTouch: true })).toBe(false);
  });

  it('rejects a long press', () => {
    expect(isTapGesture({ ...base, upTime: 1000 })).toBe(false);
  });
});