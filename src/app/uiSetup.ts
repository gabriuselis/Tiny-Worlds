import * as THREE from 'three';
import Decimal from 'break_infinity.js';
import { upgradeCost } from '../core/config/upgrades';
import { gte, format } from '../core/money';
import type { Role, UpgradeId } from '../core/state';
import { UI, showToast } from '../ui/ui';
import { ctx } from './context';
import { showError } from './errors';
import { addWorker } from './workerVisuals';

export function initUi(): void {
  const ui = new UI(showError);
  ctx.ui = ui;
  const state = ctx.state;
  try {
    ui.setHireHandler('planter', () => addWorker('planter'));
    ui.setHireHandler('lumberjack', () => addWorker('lumberjack'));
    ui.setHireHandler('carrier', () => addWorker('carrier'));

    ui.setUpgradeHandler((id: UpgradeId) => {
      try {
        const ok = ctx.progression.upgrade(id);
        if (!ok) {
          const level = state.upgrades[id];
          const cost = upgradeCost(id, level);
          if (!gte(state.currencies.credits, cost)) {
            showToast(`Not enough credits for ${id} (need ${format(cost)})`);
          } else {
            showToast(`${id} is already at max level`);
          }
          return;
        }
        // "+1 level" floating text + small bump on the card button.
        const btn = document.getElementById(`ui-btn-${id}`);
        if (btn) {
          btn.classList.remove('pulse');
          void (btn as HTMLElement).offsetWidth;
          btn.classList.add('pulse');
        }
        ctx.floaters?.spawn(new THREE.Vector3(0, 1, 0), `+1 ${id}`);
        ui.bumpWood();
        ctx.uiNeedsUpdate = true;
      } catch (err) { showError(`setUpgradeHandler: ${err instanceof Error ? err.message : err}`); }
    });

    // Quick upgrade (green star): buy the cheapest affordable item among
    // hire planter, hire lumberjack, hire carrier and the three real upgrades.
    const quickBuy = document.getElementById('ui-quick-buy');
    if (quickBuy) {
      quickBuy.addEventListener('click', (e) => {
        e.stopPropagation();
        try {
          const candidates: { id: UpgradeId; cost: Decimal }[] = [];
          for (const id of ['planter', 'lumberjack', 'carrier', 'plantSpeed', 'chopSpeed', 'woodValue'] as UpgradeId[]) {
            const cost = upgradeCost(id, state.upgrades[id]);
            if (gte(state.currencies.credits, cost)) candidates.push({ id, cost });
          }
          if (candidates.length === 0) {
            showToast('Nothing affordable yet');
            return;
          }
          candidates.sort((a, b) => a.cost.toNumber() - b.cost.toNumber());
          const target = candidates[0].id;
          const role = target === 'planter' || target === 'lumberjack' || target === 'carrier';
          if (role) {
            addWorker(target as Role);
          } else {
            ctx.progression.upgrade(target);
          }
          ctx.uiNeedsUpdate = true;
        } catch (err) { showError('quick buy failed', err); }
      });
    }

    ui.setDevHandlers({
      onToggleSpeed: () => { /* handled by UI internally */ },
      onToggleAuto: () => { /* handled by UI internally */ },
    });
  } catch (err) { showError('UI handler setup failed', err); }
}
