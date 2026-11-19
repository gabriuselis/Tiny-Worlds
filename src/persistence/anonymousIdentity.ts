import type { UserIdentity } from '../core/ports';

const KEY = 'tiny_worlds_anonymous_id_v1';

export class AnonymousLocalIdentity implements UserIdentity {
  userId(): string {
    try {
      const existing = localStorage.getItem(KEY);
      if (existing) return existing;
      const created = `anon:${crypto.randomUUID()}`;
      localStorage.setItem(KEY, created);
      return created;
    } catch {
      return 'anon:session';
    }
  }
}
