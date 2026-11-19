import { describe, it, expect } from 'vitest';
import Decimal from 'break_infinity.js';
import { deserialize, serialize } from '../src/core/save';
import { initialState } from '../src/core/state';

function legacyStringSave(overrides: (raw: any) => void = () => {}): string {
  const raw = JSON.parse(JSON.stringify(initialState()));
  overrides(raw);
  return JSON.stringify(raw);
}

describe('save round trip', () => {
  it('writes Decimals in the tagged format', () => {
    const s = initialState();
    s.prestige.starDust = new Decimal(42);
    const raw = JSON.parse(serialize(s));
    expect(raw.prestige.starDust).toEqual({ __decimal: '42' });
    expect(raw.currencies.credits).toHaveProperty('__decimal');
  });

  it('restores every Decimal field as a Decimal with the same value', () => {
    const s = initialState();
    s.currencies.credits = new Decimal('1e300');
    s.currencies.starDust = new Decimal(7);
    s.prestige.starDust = new Decimal(9);
    s.wood = new Decimal(123);
    s.woodToSell = new Decimal(4);
    s.stats.woodSold = new Decimal(55);
    s.stats.lifetimeCredits = new Decimal('2.5e12');

    const loaded = deserialize(serialize(s))!;

    for (const [got, want] of [
      [loaded.currencies.credits, s.currencies.credits],
      [loaded.currencies.starDust, s.currencies.starDust],
      [loaded.prestige.starDust, s.prestige.starDust],
      [loaded.wood, s.wood],
      [loaded.woodToSell, s.woodToSell],
      [loaded.stats.woodSold, s.stats.woodSold],
      [loaded.stats.lifetimeCredits, s.stats.lifetimeCredits],
    ] as const) {
      expect(got).toBeInstanceOf(Decimal);
      expect(got.eq(want)).toBe(true);
    }
    expect(loaded.prestige.starDust.toNumber()).toBe(9);
  });

  it('restores planet resources as Decimals', () => {
    const s = initialState();
    const key = Object.keys(s.planets.verdant.resources)[0] as keyof typeof s.planets.verdant.resources;
    s.planets.verdant.resources[key] = new Decimal(31);
    const loaded = deserialize(serialize(s))!;
    for (const value of Object.values(loaded.planets.verdant.resources)) {
      expect(value).toBeInstanceOf(Decimal);
    }
    expect(loaded.planets.verdant.resources[key].toNumber()).toBe(31);
  });

  it('keeps non-Decimal fields untouched', () => {
    const s = initialState();
    s.currencies.gems = 12;
    s.prestige.count = 3;
    s.stats.treesPlanted = 99;
    const loaded = deserialize(serialize(s))!;
    expect(loaded.currencies.gems).toBe(12);
    expect(loaded.prestige.count).toBe(3);
    expect(loaded.stats.treesPlanted).toBe(99);
  });
});

describe('legacy saves with Decimals stored as bare strings', () => {
  it('heals them into Decimals so economy code never sees a string', () => {
    const json = legacyStringSave((raw) => {
      raw.prestige.starDust = '5';
      raw.currencies.credits = '1000';
      raw.currencies.starDust = '2';
      raw.wood = '10';
      raw.woodToSell = '3';
      raw.stats.woodSold = '8';
      raw.stats.lifetimeCredits = '1e9';
      for (const k of Object.keys(raw.planets.verdant.resources)) raw.planets.verdant.resources[k] = '0';
    });
    const loaded = deserialize(json)!;
    expect(loaded.prestige.starDust).toBeInstanceOf(Decimal);
    expect(loaded.prestige.starDust.toNumber()).toBe(5);
    expect(loaded.currencies.credits.toNumber()).toBe(1000);
    expect(loaded.stats.lifetimeCredits.eq(new Decimal('1e9'))).toBe(true);
    for (const value of Object.values(loaded.planets.verdant.resources)) {
      expect(value).toBeInstanceOf(Decimal);
    }
  });

  it('falls back to defaults for unparseable or missing money fields', () => {
    const json = legacyStringSave((raw) => {
      raw.prestige.starDust = 'not a number';
      delete raw.stats.woodSold;
    });
    const loaded = deserialize(json)!;
    expect(loaded.prestige.starDust).toBeInstanceOf(Decimal);
    expect(loaded.prestige.starDust.toNumber()).toBe(0);
    expect(loaded.stats.woodSold).toBeInstanceOf(Decimal);
  });

  it('accepts plain numbers saved for credits', () => {
    const json = legacyStringSave((raw) => {
      raw.currencies.credits = 250;
    });
    expect(deserialize(json)!.currencies.credits.toNumber()).toBe(250);
  });
});
