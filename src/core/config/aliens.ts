import type { ResourceId } from '../state';

export interface AlienSpecies {
  id: string;
  name: string;
  favorite: ResourceId;
  bonusMin: number;
  bonusMax: number;
  color: string;
}

export const ALIEN_SPECIES: AlienSpecies[] = [
  { id: 'blobs', name: 'Blobs', favorite: 'wood', bonusMin: 1.25, bonusMax: 1.5, color: '#ff6b6b' },
  { id: 'gloops', name: 'Gloops', favorite: 'stone', bonusMin: 1.5, bonusMax: 1.75, color: '#4ecdc4' },
  { id: 'zorks', name: 'Zorks', favorite: 'ore', bonusMin: 1.75, bonusMax: 2.0, color: '#ffe66d' },
];

export const VISIT_ROTATION_SECONDS = 180;

export interface AlienRequest {
  id: string;
  resource: ResourceId;
  amount: number;
  reward: { credits: number; gems: number };
  durationSeconds: number;
  expiresAt: number;
}
