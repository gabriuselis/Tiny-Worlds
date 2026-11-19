import type { ProgressionSnapshot } from './progression';

export interface Clock {
  now(): number;
}

export interface IdGenerator {
  next(): number;
}

export interface UserIdentity {
  userId(): string;
}

export interface ProgressionRepository {
  load(userId: string): Promise<ProgressionSnapshot | null>;
  save(userId: string, snapshot: ProgressionSnapshot): Promise<void>;
}
