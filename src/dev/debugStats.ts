import { updateDevStats, logEvent } from '../ui/ui';
import { ctx } from '../app/context';

let debugFrameCount = 0;
let debugLastTime = performance.now();
export let debugFPS = 0;

let fpsCounterEl: HTMLElement | null = null;
let fpsCounterVisible = false;
let logBoxHidden = true;

// Called once per frame by the main loop; publishes FPS/plot count once a second.
export function tickDebugStats(): void {
  debugFrameCount++;
  const nowTime = performance.now();
  if (nowTime - debugLastTime >= 1000) {
    debugFPS = debugFrameCount;
    updateDevStats(ctx.verdant.plots.length, debugFPS);
    (window as any).__debugFPS = debugFPS;
    (window as any).__plotCount = ctx.verdant.plots.length;
    if (fpsCounterEl) fpsCounterEl.textContent = `FPS: ${debugFPS}`;
    logEvent(`UI render calls/sec: ${ctx.uiRenderCount}`);
    ctx.uiRenderCount = 0;
    debugFrameCount = 0;
    debugLastTime = nowTime;
  }
}

export function installDebugStatsHooks(): void {
  // Show FPS toggle (dev)
  (window as any).__toggleFps = () => {
    fpsCounterVisible = !fpsCounterVisible;
    if (fpsCounterVisible) {
      if (!fpsCounterEl) {
        fpsCounterEl = document.createElement('div');
        fpsCounterEl.id = 'ui-fps-counter';
        fpsCounterEl.style.cssText = `position:fixed;top:8px;right:8px;z-index:2147483647;pointer-events:none;font-family:monospace;font-size:12px;color:#0f0;background:rgba(0,0,0,0.8);padding:6px 10px;border-radius:6px;border:1px solid #0f0;`;
        document.body.appendChild(fpsCounterEl);
      }
      fpsCounterEl.style.display = 'block';
    } else if (fpsCounterEl) {
      fpsCounterEl.style.display = 'none';
    }
    logEvent(`__toggleFps: ${fpsCounterVisible ? 'on' : 'off'}`);
  };

  // Hide debug log toggle (dev)
  (window as any).__toggleLog = () => {
    logBoxHidden = !logBoxHidden;
    const lb = document.getElementById('ui-log-box');
    if (lb) lb.style.display = logBoxHidden ? 'none' : 'block';
    logEvent(`__toggleLog: ${logBoxHidden ? 'hidden' : 'shown'}`);
  };
}
