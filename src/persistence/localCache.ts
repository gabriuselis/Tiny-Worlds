import { initialState, type GameState } from '../core/state';
import { applyProgression, captureProgression, type ProgressionSnapshot } from '../core/progression';
import { applyWorld, captureWorld } from '../core/worldSnapshot';
import { deserializeProgression, deserializeWorld, serialize } from '../core/save';
import type { ProgressionRepository } from '../core/ports';
import { clearLegacy, loadLegacy } from './legacySave';

const PROGRESSION_KEY = 'tiny_worlds_progression_v1';
const WORLD_KEY = 'tiny_worlds_world_v1';

export class LocalStorageProgressionRepository implements ProgressionRepository {
  private progressionKey(userId: string): string { return `${PROGRESSION_KEY}:${userId}`; }
  private worldKey(userId: string): string { return `${WORLD_KEY}:${userId}`; }

  loadSync(userId: string): ProgressionSnapshot | null {
    try {
      const raw = localStorage.getItem(this.progressionKey(userId));
      return raw ? deserializeProgression(raw) : null;
    } catch { return null; }
  }

  saveSync(userId: string, snapshot: ProgressionSnapshot): boolean {
    try {
      localStorage.setItem(this.progressionKey(userId), serialize(snapshot));
      return true;
    } catch { return false; }
  }

  loadGame(userId: string, nowMs: number): { state: GameState; progression: ProgressionSnapshot | null } {
    const progression = this.loadSync(userId);
    if (progression) {
      const state = initialState(nowMs);
      applyProgression(state, progression);
      try {
        const raw = localStorage.getItem(this.worldKey(userId));
        const world = raw ? deserializeWorld(raw) : null;
        if (world) applyWorld(state, world);
      } catch { /* progression is still usable */ }
      return { state, progression };
    }

    const legacy = loadLegacy();
    if (legacy) {
      const migrated = captureProgression(legacy, 0, legacy.lastSaved);
      const saved = this.saveWorldSync(userId, legacy) && this.saveSync(userId, migrated);
      if (saved) clearLegacy();
      return { state: legacy, progression: migrated };
    }
    return { state: initialState(nowMs), progression: null };
  }

  saveWorldSync(userId: string, state: GameState): boolean {
    try {
      localStorage.setItem(this.worldKey(userId), serialize(captureWorld(state)));
      return true;
    } catch { return false; }
  }

  clear(userId: string): void {
    try {
      localStorage.removeItem(this.progressionKey(userId));
      localStorage.removeItem(this.worldKey(userId));
      clearLegacy();
    } catch { /* best effort */ }
  }

  async load(userId: string): Promise<ProgressionSnapshot | null> { return this.loadSync(userId); }
  async save(userId: string, snapshot: ProgressionSnapshot): Promise<void> {
    this.saveSync(userId, snapshot);
  }
}
