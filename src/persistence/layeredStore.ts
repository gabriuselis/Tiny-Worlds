import type { Clock, ProgressionRepository } from '../core/ports';
import { applyProgression, captureProgression, type ProgressionSnapshot } from '../core/progression';
import { deserializeProgression, serialize } from '../core/save';
import type { GameState } from '../core/state';
import { LocalStorageProgressionRepository } from './localCache';

export const REMOTE_DEBOUNCE_MS = 15000;

export class LayeredProgressionStore {
  private revision: number;
  private savedContent: string | null;
  private pending: ProgressionSnapshot | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private sending: Promise<void> | null = null;
  private generation = 0;

  constructor(
    private readonly state: GameState,
    private readonly userId: string,
    private readonly cache: LocalStorageProgressionRepository,
    private readonly remote: ProgressionRepository,
    private readonly clock: Clock,
    private readonly onRemoteApplied: () => void,
    initial: ProgressionSnapshot | null,
  ) {
    this.revision = initial?.revision ?? 0;
    this.savedContent = initial ? this.content(initial) : null;
  }

  private content(snapshot: ProgressionSnapshot): string {
    return serialize({ ...snapshot, revision: 0, updatedAt: 0 });
  }

  start(): Promise<void> {
    const generation = this.generation;
    return Promise.resolve().then(() => this.remote.load(this.userId)).then((untrusted) => {
      if (generation !== this.generation) return;
      const remote = untrusted ? deserializeProgression(serialize(untrusted)) : null;
      if (!remote || remote.revision < this.revision) {
        if (this.savedContent) {
          this.pending = captureProgression(this.state, this.revision, this.state.lastSaved);
          this.scheduleRemote();
        }
        return;
      }
      if (this.pending && this.pending.revision <= remote.revision) {
        this.pending = null;
        if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
      }
      applyProgression(this.state, remote);
      this.revision = remote.revision;
      this.savedContent = this.content(remote);
      this.cache.saveSync(this.userId, remote);
      this.onRemoteApplied();
    }).catch(() => { /* remote access cannot interrupt gameplay */ });
  }

  saveProgression(): void {
    const now = this.clock.now();
    this.state.lastSaved = now;
    const candidate = captureProgression(this.state, this.revision, now);
    const content = this.content(candidate);
    if (content !== this.savedContent) {
      candidate.revision = ++this.revision;
      if (this.cache.saveSync(this.userId, candidate)) {
        this.savedContent = content;
      }
      this.pending = candidate;
      this.scheduleRemote();
    }
  }

  saveWorld(): void {
    this.state.lastSaved = this.clock.now();
    this.cache.saveWorldSync(this.userId, this.state);
  }

  saveCurrent(): void {
    this.saveProgression();
    this.saveWorld();
  }

  async flushRemote(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    if (this.sending) {
      await this.sending;
      if (this.pending) this.scheduleRemote();
      return;
    }
    const snapshot = this.pending;
    this.pending = null;
    if (!snapshot) return;
    this.sending = Promise.resolve().then(() => this.remote.save(this.userId, snapshot))
      .catch(() => {
        if (!this.pending || this.pending.revision < snapshot.revision) this.pending = snapshot;
      });
    await this.sending;
    this.sending = null;
    if (this.pending) this.scheduleRemote();
  }

  private scheduleRemote(): void {
    if (!this.timer) this.timer = setTimeout(() => { void this.flushRemote(); }, REMOTE_DEBOUNCE_MS);
  }

  resetAfterGameReset(): void {
    this.generation += 1;
    this.cache.clear(this.userId);
    this.savedContent = null;
    this.saveCurrent();
  }
}
