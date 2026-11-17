export interface PlanetArea {
  cx: number;
  cy: number;
  size: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export function getPlanetArea(): PlanetArea | null {
  const elTop = document.querySelector('[data-area-top]') as HTMLElement | null;
  const elBottom = document.querySelector('[data-area-bottom]') as HTMLElement | null;
  const elLeft = document.querySelector('[data-area-left]') as HTMLElement | null;
  const elRight = document.querySelector('[data-area-right]') as HTMLElement | null;

  if (!elTop || !elBottom || !elLeft || !elRight) return null;

  const top = elTop.getBoundingClientRect().bottom + 8;
  const bottom = elBottom.getBoundingClientRect().top - 8;
  const left = elLeft.getBoundingClientRect().right + 8;
  const right = elRight.getBoundingClientRect().left - 8;

  if (bottom <= top || right <= left) return null;

  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const size = Math.min(right - left, bottom - top);

  return { cx, cy, size, left, right, top, bottom };
}
