export interface PlanetArea {
  cx: number;
  cy: number;
  size: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface AreaEls {
  top: HTMLElement;
  bottom: HTMLElement;
  left: HTMLElement;
  right: HTMLElement;
}

let cached: AreaEls | null = null;

function areaElements(): AreaEls | null {
  if (cached && cached.top.isConnected && cached.bottom.isConnected && cached.left.isConnected && cached.right.isConnected) {
    return cached;
  }
  const top = document.querySelector<HTMLElement>('[data-area-top]');
  const bottom = document.querySelector<HTMLElement>('[data-area-bottom]');
  const left = document.querySelector<HTMLElement>('[data-area-left]');
  const right = document.querySelector<HTMLElement>('[data-area-right]');
  cached = top && bottom && left && right ? { top, bottom, left, right } : null;
  return cached;
}

export function getPlanetArea(): PlanetArea | null {
  const els = areaElements();
  if (!els) return null;

  const top = els.top.getBoundingClientRect().bottom + 8;
  const bottom = els.bottom.getBoundingClientRect().top - 8;
  const left = els.left.getBoundingClientRect().right + 8;
  const right = els.right.getBoundingClientRect().left - 8;

  if (bottom <= top || right <= left) return null;

  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const size = Math.min(right - left, bottom - top);

  return { cx, cy, size, left, right, top, bottom };
}
