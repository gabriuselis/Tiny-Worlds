import * as THREE from 'three';
import { upgradeCost } from '../core/config/upgrades';
import { gte, format } from '../core/money';
import type { UpgradeId } from '../core/state';
import { UI, showToast } from '../ui/ui';
import { ctx } from './context';
import { showError } from './errors';
import { addWorker } from './workerVisuals';
import { spendableWood, getBlessingsStatus, buyBlessing } from '../core/blessings';

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

    ui.setBlessingHandler((id: string) => {
      try {
        const ok = buyBlessing(state, id as any);
        if (ok) {
          showToast(`Blessing unlocked: ${id}`);
          ctx.uiNeedsUpdate = true;
        } else {
          const status = getBlessingsStatus(state);
          const blessing = status.find((b) => b.config && b.config.id === id);
          if (blessing?.owned) {
            showToast('Already owned');
          } else if (blessing?.config) {
            showToast(`Not enough wood (need ${format(blessing.config.woodCost)})`);
          } else {
            showToast('Blessing not found');
          }
        }
      } catch (err) { showError(`setBlessingHandler: ${err instanceof Error ? err.message : err}`); }
    });

    // Expose blessings API for modal live updates
    (window as any).__blessingsAPI = { spendableWood, getBlessingsStatus };
    (window as any).__gameState = state;
    (window as any).__addWood = (amt: number) => { state.wood = state.wood.add(amt); ctx.uiNeedsUpdate = true; };

    ui.setDevHandlers({
      onToggleSpeed: () => { /* handled by UI internally */ },
      onToggleAuto: () => { /* handled by UI internally */ },
    });
  } catch (err) { showError('UI handler setup failed', err); }
}
