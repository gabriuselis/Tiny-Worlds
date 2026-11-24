// Pure, DOM-free helpers for tap-to-collect hit testing. Kept small and
// dependency-free so they can be unit tested without a browser or Three.js.

export const TAP_PICK_RADIUS_PX = 40;
export const TAP_MOVE_TOLERANCE_PX = 8;
export const TAP_MAX_DURATION_MS = 350;

/** A log pile already projected to screen pixels by the caller. */
export interface ScreenPile {
  id: number;
  x: number;
  y: number;
  /** Front-facing and in front of the camera (back-face check already applied). */
  visible: boolean;
}

/**
 * Nearest visible pile within `maxPx` of the tap, or null.
 * Piles flagged not visible (far side of the planet / behind camera) are ignored.
 */
export function pickNearestPile(
  piles: readonly ScreenPile[],
  tapX: number,
  tapY: number,
  maxPx: number = TAP_PICK_RADIUS_PX,
): ScreenPile | null {
  let best: ScreenPile | null = null;
  let bestDist = Infinity;
  for (const p of piles) {
    if (!p.visible) continue;
    const d = Math.hypot(p.x - tapX, p.y - tapY);
    if (d <= maxPx && d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

export interface TapGestureInput {
  downX: number;
  downY: number;
  upX: number;
  upY: number;
  downTime: number;
  upTime: number;
  /** True if a second finger / pinch was involved during this gesture. */
  multiTouch: boolean;
}

/** True only for a short, still, single-finger press (a tap, not a drag/pinch). */
export function isTapGesture(g: TapGestureInput): boolean {
  if (g.multiTouch) return false;
  if (Math.hypot(g.upX - g.downX, g.upY - g.downY) > TAP_MOVE_TOLERANCE_PX) return false;
  if (g.upTime - g.downTime >= TAP_MAX_DURATION_MS) return false;
  return true;
}