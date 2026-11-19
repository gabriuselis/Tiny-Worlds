import { deserialize } from '../core/save';
import type { GameState } from '../core/state';

export const LEGACY_STORAGE_KEY = 'tiny_worlds_save_v1';

export function loadLegacy(): GameState | null {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    return raw ? deserialize(raw) : null;
  } catch { return null; }
}

export function clearLegacy(): void {
  try { localStorage.removeItem(LEGACY_STORAGE_KEY); } catch {}
}
