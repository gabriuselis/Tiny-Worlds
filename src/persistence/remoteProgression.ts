import type { ProgressionRepository } from '../core/ports';
import type { ProgressionSnapshot } from '../core/progression';

/** DB boundary. Replace these method bodies when an endpoint is available. */
export class RemoteProgressionRepository implements ProgressionRepository {
  async load(_userId: string): Promise<ProgressionSnapshot | null> { return null; }
  async save(_userId: string, _snapshot: ProgressionSnapshot): Promise<void> {}
}
