import { openDevDialog as openDevMenu } from '../ui/ui';
import { ctx } from './context';
import { updateViewport } from './camera';
import { startLoop, stopLoop, shutdownApp } from './loop';

// Reset save button (trash icon) — opens dev menu only; never reloads.
// Reset game lives inside the dev menu with double-tap confirmation.
export function wireResetSaveButton(): void {
  const btnResetSave = document.getElementById('ui-reset-save') as HTMLButtonElement;
  if (btnResetSave) {
    btnResetSave.type = 'button';
    btnResetSave.addEventListener('click', (e) => {
      e.stopPropagation();
      openDevMenu();
    });
  }
}

export function installEvents(): void {
  window.addEventListener('resize', () => {
    updateViewport();
  });
  window.addEventListener('orientationchange', () => {
    requestAnimationFrame(() => {
      requestAnimationFrame(updateViewport);
    });
  });
  window.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      ctx.isPaused = true;
      try { ctx.progressionStore.saveCurrent(); void ctx.progressionStore.flushRemote(); } catch { /* save may fail if state is undefined */ }
    } else {
      ctx.isPaused = false;
      ctx.lastTime = performance.now(); // reset to avoid huge dt on return
    }
  }, { passive: true });

  window.addEventListener('beforeunload', () => {
    try { sessionStorage.setItem('tw_last_unload', String(Date.now())); } catch { /* ignore */ }
  }, { passive: true });
  window.addEventListener('pagehide', (e) => {
    try { sessionStorage.setItem('tw_last_pagehide', String(Date.now())); } catch { /* ignore */ }
    if (e.persisted) {
      // Page may be restored from the back/forward cache: keep resources, just pause.
      try { ctx.progressionStore.saveCurrent(); void ctx.progressionStore.flushRemote(); } catch { /* ignore */ }
      stopLoop();
    } else {
      shutdownApp();
    }
  }, { passive: true });
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) startLoop();
  }, { passive: true });

  // Debug: triple-tap TW badge opens dev menu
  const badgeEl = document.getElementById('ui-player-badge');
  if (badgeEl) {
    badgeEl.addEventListener('click', (e) => {
      e.stopPropagation();
      openDevMenu();
    });
  }

  // Trash button next to Settings opens the dev menu
  const btnDev = document.getElementById('ui-reset-save');
  if (btnDev) {
    btnDev.addEventListener('click', (e) => {
      e.stopPropagation();
      openDevMenu();
    });
  }
}
