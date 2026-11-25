import { describe, it, expect } from 'vitest';
import Decimal from 'break_infinity.js';
import { initialState } from '../src/core/state';
import { spendableWood, buyBlessing, blessingWoodValueMultiplier, blessingCarrierSpeedMultiplier, getBlessingsStatus } from '../src/core/blessings';
import { sellWood } from '../src/core/progressionCommands';
import { serialize, deserialize } from '../src/core/save';

describe('blessings', () => {
  function freshState() {
    const s = initialState();
    // Give enough wood for testing
    s.wood = new Decimal(100000);
    s.woodSpent = new Decimal(0);
    return s;
  }

  it('spendableWood = wood - woodSpent', () => {
    const s = freshState();
    s.wood = new Decimal(50000);
    s.woodSpent = new Decimal(10000);
    expect(spendableWood(s).toNumber()).toBe(40000);
  });

  it('cannot buy without enough spendable wood', () => {
    const s = freshState();
    s.wood = new Decimal(20000); // Less than 25000 cost
    expect(buyBlessing(s, 'woodValue')).toBe(false);
    expect(s.blessings).not.toContain('woodValue');
    expect(s.woodSpent.toNumber()).toBe(0);
  });

  it('buy once only - second purchase fails', () => {
    const s = freshState();
    expect(buyBlessing(s, 'woodValue')).toBe(true);
    expect(buyBlessing(s, 'woodValue')).toBe(false);
    expect(s.blessings.filter((b) => b === 'woodValue')).toHaveLength(1);
  });

  it('woodSpent grows and cumulative wood unchanged', () => {
    const s = freshState();
    s.wood = new Decimal(100000);
    const woodBefore = s.wood.toNumber();
    expect(buyBlessing(s, 'woodValue')).toBe(true); // 25000
    expect(s.woodSpent.toNumber()).toBe(25000);
    expect(s.wood.toNumber()).toBe(woodBefore); // cumulative unchanged
    expect(buyBlessing(s, 'planters')).toBe(true); // 27000
    expect(s.woodSpent.toNumber()).toBe(52000);
    expect(s.wood.toNumber()).toBe(woodBefore);
  });

  it('2x wood value doubles credits per log', () => {
    const s = freshState();
    s.upgrades.woodValue = 0;
    s.woodToSell = new Decimal(1);
    
    // Without blessing: 1 log * 2 credits = 2 credits
    expect(sellWood(s, 1).toNumber()).toBe(2);
    s.woodToSell = new Decimal(1);
    s.currencies.credits = new Decimal(100);
    
    // Buy first 2x wood value blessing
    buyBlessing(s, 'woodValue');
    expect(blessingWoodValueMultiplier(s)).toBe(2);
    expect(sellWood(s, 1).toNumber()).toBe(4); // 2 * 2 = 4
    
    // Buy second 2x wood value blessing
    s.woodToSell = new Decimal(1);
    buyBlessing(s, 'woodValue2');
    expect(blessingWoodValueMultiplier(s)).toBe(4);
    expect(sellWood(s, 1).toNumber()).toBe(8); // 2 * 4 = 8
  });

  it('+25 planters adds 25 workers', () => {
    const s = freshState();
    const before = s.planets.verdant.workers.filter((w) => w.role === 'planter').length;
    expect(buyBlessing(s, 'planters')).toBe(true);
    const after = s.planets.verdant.workers.filter((w) => w.role === 'planter').length;
    expect(after - before).toBe(25);
  });

  it('+25 lumberjacks adds 25 workers', () => {
    const s = freshState();
    const before = s.planets.verdant.workers.filter((w) => w.role === 'lumberjack').length;
    expect(buyBlessing(s, 'lumberjacks')).toBe(true);
    const after = s.planets.verdant.workers.filter((w) => w.role === 'lumberjack').length;
    expect(after - before).toBe(25);
  });

  it('+25 carriers adds 25 workers', () => {
    const s = freshState();
    const before = s.planets.verdant.workers.filter((w) => w.role === 'carrier').length;
    expect(buyBlessing(s, 'carriers')).toBe(true);
    const after = s.planets.verdant.workers.filter((w) => w.role === 'carrier').length;
    expect(after - before).toBe(25);
  });

  it('carrier speed multiplier is 2x after blessing', () => {
    const s = freshState();
    expect(blessingCarrierSpeedMultiplier(s)).toBe(1);
    expect(buyBlessing(s, 'carrierSpeed')).toBe(true);
    expect(blessingCarrierSpeedMultiplier(s)).toBe(2);
  });

  it('save/restore keeps owned blessings and woodSpent', () => {
    const s = freshState();
    s.wood = new Decimal(100000);
    buyBlessing(s, 'woodValue');
    buyBlessing(s, 'planters');
    const woodSpentBefore = s.woodSpent.toNumber();
    const blessingsBefore = [...s.blessings];
    
    // Serialize and deserialize
    const json = serialize(s);
    const loaded = deserialize(json)!;
    
    expect(loaded.woodSpent.toNumber()).toBe(woodSpentBefore);
    expect(loaded.blessings).toEqual(blessingsBefore);
    expect(blessingWoodValueMultiplier(loaded)).toBe(2);
  });

  it('getBlessingsStatus reports correct affordability', () => {
    const s = freshState();
    s.wood = new Decimal(26000);
    const status = getBlessingsStatus(s);
    const woodValue = status.find((b) => b.config?.id === 'woodValue');
    expect(woodValue).toBeDefined();
    expect(woodValue!.owned).toBe(false);
    expect(woodValue!.affordable).toBe(true);
    
    const planters = status.find((b) => b.config?.id === 'planters');
    expect(planters).toBeDefined();
    expect(planters!.affordable).toBe(false); // 27000 > 26000
    
    buyBlessing(s, 'woodValue');
    const status2 = getBlessingsStatus(s);
    const woodValue2 = status2.find((b) => b.config?.id === 'woodValue');
    expect(woodValue2).toBeDefined();
    expect(woodValue2!.owned).toBe(true);
    expect(woodValue2!.affordable).toBe(false);
  });

  it('old saves load with no blessings and zero woodSpent', () => {
    const s = initialState();
    // Simulate old save without blessings/woodSpent
    const json = serialize(s);
    const raw = JSON.parse(json);
    delete raw.blessings;
    delete raw.woodSpent;
    const oldJson = JSON.stringify(raw);
    const loaded = deserialize(oldJson)!;
    
    expect(loaded.blessings).toEqual([]);
    expect(loaded.woodSpent.toNumber()).toBe(0);
    expect(blessingWoodValueMultiplier(loaded)).toBe(1);
    expect(blessingCarrierSpeedMultiplier(loaded)).toBe(1);
  });

  it('reset clears blessings and woodSpent', async () => {
    const s = freshState();
    s.wood = new Decimal(100000);
    buyBlessing(s, 'woodValue');
    buyBlessing(s, 'planters');
    expect(s.blessings.length).toBe(2);
    expect(s.woodSpent.toNumber()).toBeGreaterThan(0);
    
    const { resetGame } = await import('../src/core/game');
    resetGame(s);
    
    expect(s.blessings).toEqual([]);
    expect(s.woodSpent.toNumber()).toBe(0);
    expect(s.wood.toNumber()).toBe(0);
  });

  it('hasAffordableBlessing returns true when affordable, false when not or all owned', async () => {
    const s = freshState();
    const { hasAffordableBlessing } = await import('../src/core/blessings');
    
    // No wood - not affordable
    s.wood = new Decimal(0);
    expect(hasAffordableBlessing(s)).toBe(false);
    
    // Enough for first blessing (25000) - affordable
    s.wood = new Decimal(25000);
    expect(hasAffordableBlessing(s)).toBe(true);
    
    // Buy it - no longer affordable
    buyBlessing(s, 'woodValue');
    expect(hasAffordableBlessing(s)).toBe(false);
    
    // Add more wood - affordable again (next blessing is 27000)
    s.wood = new Decimal(52000); // 25000 spent + 27000 needed
    expect(hasAffordableBlessing(s)).toBe(true);
    
    // Buy all blessings - should be false
    buyBlessing(s, 'planters');
    buyBlessing(s, 'lumberjacks');
    buyBlessing(s, 'carrierSpeed');
    buyBlessing(s, 'carriers');
    buyBlessing(s, 'woodValue2');
    expect(hasAffordableBlessing(s)).toBe(false);
  });

  it('blessing workers do not raise next hire cost', async () => {
    const s = freshState();
    s.wood = new Decimal(100000);
    const { costOf } = await import('../src/core/config/workers');
    const initialCost = costOf('planter', 0);
    
    // Buy +25 Planters blessing
    buyBlessing(s, 'planters');
    expect(s.planets.verdant.workers.filter((w) => w.role === 'planter').length).toBe(25);
    expect(s.upgrades.planter).toBe(0); // upgrade level unchanged
    
    // Hire cost should still be based on 0 purchased
    expect(costOf('planter', s.upgrades.planter)).toEqual(initialCost);
    
    // Now hire a planter for credits - should increment upgrade level
    s.currencies.credits = new Decimal(1000);
    const { hireWorker } = await import('../src/core/workers');
    hireWorker(s, 'planter', { free: false });
    expect(s.upgrades.planter).toBe(1);
    expect(costOf('planter', s.upgrades.planter)).toEqual(costOf('planter', 1));
  });
});