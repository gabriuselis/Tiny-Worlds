import { buyUpgrade } from '../core/game';
import { hireWorker } from '../core/workers';
import { tick } from '../core/sim';
import { resetGame, seedEmptyPlots, type PlotSeed } from '../core/game';
import type { GameState, Role, UpgradeId, Vec3, Worker } from '../core/state';
import type { IdGenerator } from '../core/ports';
import type { LayeredProgressionStore } from '../persistence/layeredStore';

class SequentialIds implements IdGenerator {
  private value = 0;
  next(): number { return ++this.value; }
}

/** Live mutation boundary. See .agents/skills/progression-boundary/SKILL.md. */
export class Progression {
  private readonly ids = new SequentialIds();

  constructor(private readonly state: GameState, private readonly store: LayeredProgressionStore) {}

  private change<T>(command: () => T, saveWorld: boolean): T {
    try { return command(); }
    finally {
      if (saveWorld) this.store.saveCurrent();
      else this.store.saveProgression();
    }
  }

  hire(role: Role, free = false, spawnDir?: Vec3): Worker | undefined {
    return this.change(() => hireWorker(this.state, role, { free, spawnDir, ids: this.ids }), true);
  }

  upgrade(id: UpgradeId): boolean {
    return this.change(() => buyUpgrade(this.state, id), false);
  }

  advance(dt: number): void {
    this.change(() => tick(this.state, dt), false);
  }

  devChange<T>(command: (state: GameState) => T): T {
    return this.change(() => command(this.state), true);
  }

  reset(seeds: PlotSeed[], nowMs: number): void {
    resetGame(this.state, nowMs);
    seedEmptyPlots(this.state, seeds);
    this.store.resetAfterGameReset();
  }
}
