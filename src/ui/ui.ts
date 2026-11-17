import Decimal from 'break_infinity.js';
import { PLANETS } from '../core/config/planets';
import { costOf } from '../core/config/workers';
import { upgradeCost } from '../core/config/upgrades';
import { incomePerSecond } from '../core/economy';
import type { GameState, Role, UpgradeId } from '../core/state';

// ============================================================
// Diagnostic log box (bottom-left, monospace, pointer-events none)
// ============================================================

let logBox: HTMLDivElement | null = null;
let logCount = 0;
let loadCounter = 0;

function initLogBox(): void {
  if (logBox) return;
  const stored = sessionStorage.getItem('tw_load_counter');
  loadCounter = stored ? parseInt(stored, 10) + 1 : 1;
  sessionStorage.setItem('tw_load_counter', String(loadCounter));
  logBox = document.createElement('div');
  logBox.id = 'ui-log-box';
  logBox.style.cssText = `position:fixed;bottom:2px;left:2px;z-index:2147483647;pointer-events:none;font-family:monospace;font-size:11px;color:#0f0;background:rgba(0,0,0,0.85);padding:8px 10px;border-radius:6px;max-width:46vw;max-height:34vh;overflow:auto;white-space:pre-wrap;word-break:break-all;line-height:1.4;border:1px solid #0f0;`;
  document.body.appendChild(logBox);

  // Restore last log lines from sessionStorage (survives a reload)
  const storedLog = sessionStorage.getItem('tw_log_lines');
  if (storedLog) {
    const prevLines = storedLog.split('\n').filter(Boolean);
    if (prevLines.length) {
      logBox.textContent = `LAST RELOAD REASON: previous session ended\n${prevLines.join('\n')}\n`;
    }
  }
}

function saveLogLines(): void {
  if (!logBox) return;
  const lines = logBox.textContent.split('\n').filter(Boolean).slice(0, 30);
  sessionStorage.setItem('tw_log_lines', lines.join('\n'));
}

function logEvent(msg: string, err?: unknown): void {
  initLogBox();
  if (!logBox) return;
  let detail = '';
  if (err instanceof Error) {
    detail = err.stack ? '\n  ' + err.stack.split('\n').slice(0, 3).join('\n  ') : '';
  } else if (err !== undefined) {
    detail = '\n  ' + String(err);
  }
  const line = `[${++logCount}] ${msg}${detail}\n`;
  logBox.textContent = line + logBox.textContent;
  const lines = logBox.textContent.split('\n').filter(Boolean).slice(0, 30);
  logBox.textContent = lines.join('\n') + (lines.length ? '\n' : '');
  saveLogLines();
}

function logStack(msg: string): void {
  initLogBox();
  if (!logBox) return;
  const stack = new Error().stack;
  const first3 = stack ? stack.split('\n').slice(0, 4).join('\n  ') : '';
  const line = `[${++logCount}] ${msg}\n  ${first3}\n`;
  logBox.textContent = line + logBox.textContent;
  const lines = logBox.textContent.split('\n').filter(Boolean).slice(0, 30);
  logBox.textContent = lines.join('\n') + (lines.length ? '\n' : '');
  saveLogLines();
}

// ============================================================
// MutationObserver on document.body
// ============================================================

function startMutationObserver(): void {
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'childList') {
        for (const node of m.removedNodes) {
          const el = node as HTMLElement;
          if (el.id === 'dev-menu' || (el as HTMLElement).querySelector?.('#dev-menu')) {
            logEvent('DOM: #dev-menu REMOVED from document.body');
          }
          if (el.id === 'dev-backdrop' || (el as HTMLElement).querySelector?.('#dev-backdrop')) {
            logEvent('DOM: #dev-backdrop REMOVED from document.body');
          }
        }
        for (const node of m.addedNodes) {
          const el = node as HTMLElement;
          if (el.id === 'dev-menu') {
            logEvent('DOM: #dev-menu ADDED to document.body');
          }
          if (el.id === 'dev-backdrop') {
            logEvent('DOM: #dev-backdrop ADDED to document.body');
          }
        }
      }
      if (m.type === 'attributes') {
        const target = m.target as HTMLElement;
        if (target.id === 'dev-menu' || target.id === 'dev-backdrop') {
          const attrName = m.attributeName ?? '';
          logStack(`DOM: ${target.id} attribute changed: ${attrName} = ${target.getAttribute(attrName)}`);
        }
      }
    }
  });
  observer.observe(document.body, { childList: true, attributes: true, subtree: true, attributeFilter: ['class', 'style', 'hidden', 'open'] });
}

// ============================================================
// Diagnostic window/document event listeners
// ============================================================

function startDiagnosticEvents(): void {
  const logResize = () => {
    const vv = window.visualViewport;
    logEvent(`WINDOW resize: innerHeight=${window.innerHeight} visualViewport.height=${vv?.height ?? 'n/a'}`);
  };
  const logOrient = () => logEvent(`WINDOW orientationchange`);
  const logScroll = () => logEvent(`WINDOW scroll`);
  const logVisChange = () => logEvent(`WINDOW visibilitychange: hidden=${document.hidden}`);
  const logBlur = () => logEvent(`WINDOW blur`);
  const logFocusOut = (e: FocusEvent) => {
    const t = (e.target as HTMLElement)?.id ?? String(e.target);
    logEvent(`DOCUMENT focusout: target=${t}`);
  };

  window.addEventListener('resize', logResize, { passive: true });
  window.addEventListener('orientationchange', logOrient, { passive: true });
  window.addEventListener('scroll', logScroll, { passive: true });
  window.addEventListener('visibilitychange', logVisChange, { passive: true });
  window.addEventListener('blur', logBlur, { passive: true });
  document.addEventListener('focusout', logFocusOut, { passive: true });
}

// ============================================================
// UI class (main overlay, root is NOT re-rendered)
// ============================================================

const CARD_SPECS: { id: UpgradeId; label: string }[] = [
  { id: 'planter', label: 'Hire Planter' },
  { id: 'lumberjack', label: 'Hire Lumberjack' },
  { id: 'carrier', label: 'Hire Carrier' },
  { id: 'plantSpeed', label: 'Plant Speed' },
  { id: 'chopSpeed', label: 'Chop Speed' },
  { id: 'woodValue', label: 'Wood Value' },
];

const HIRE_ROLES: Record<UpgradeId, Role | null> = {
  planter: 'planter',
  lumberjack: 'lumberjack',
  carrier: 'carrier',
  plantSpeed: null,
  chopSpeed: null,
  woodValue: null,
  tapPower: null,
  maxTrees: null,
};

export interface UIHandlers {
  onHirePlanter: () => void;
  onHireLumberjack: () => void;
  onHireCarrier: () => void;
  onToggleSpeed: () => void;
  onToggleAuto: () => void;
  onDevFill: () => void;
  onDevClear: () => void;
  onDevReset: () => void;
  onDevDensity: (count: number) => void;
  onDevToggleGrid: () => void;
}

type ReportError = (msg: string) => void;

export class UI {
  private root: HTMLElement;
  private speedActive = false;
  private autoActive = false;
  private hireHandlers: Partial<Record<Role, () => void>> = {};
  private upgradeHandler?: (id: UpgradeId) => void;
  private reportError?: ReportError;

  private elCredits!: HTMLElement;
  private elGems!: HTMLElement;
  private elIncome!: HTMLElement;
  private elWood!: HTMLElement;
  private elPlanetName!: HTMLElement;
  private elGoal!: HTMLElement;
  private elProgressLine!: HTMLElement;
  private elSpeedBtn!: HTMLElement;
  private elAutoBtn!: HTMLElement;
  private elUpgradePanel!: HTMLElement;

  // Cached last values for change detection (only patch when changed)
  private lastCredits = '';
  private lastGems = '';
  private lastIncome = '';
  private lastWood = '';
  private lastGoal = '';
  private lastSpeedActive = false;
  private lastAutoActive = false;
  private lastHarvested = 0;

  // Progress dot elements (built once)
  private progressDots: HTMLElement[] = [];
  private progressLines: HTMLElement[] = [];

  // Upgrade card element refs (built once)
  private cardBtns = new Map<UpgradeId, HTMLButtonElement>();
  private cardVals = new Map<UpgradeId, HTMLElement>();
  private cardCosts = new Map<UpgradeId, HTMLElement>();
  private lastCardValues = new Map<UpgradeId, { value: string; cost: string; affordable: boolean }>();

  // Dev menu handler callbacks
  private devHandlers: Partial<Record<string, () => void>> = {};

  constructor(reportError?: ReportError) {
    this.reportError = reportError;
    this.root = this.build();
    try {
      const app = document.getElementById('app');
      if (!app) throw new Error('#app element not found in document');
      app.appendChild(this.root);
    } catch (err) {
      this.fail('UI root append', err);
      return;
    }
    this.safe('bind toggles', () => this.bindToggles());
    this.safe('progress dots', () => this.initProgressDots());
  }

  private el(id: string): HTMLElement {
    const el = this.root.querySelector(`#${id}`) ?? document.getElementById(id);
    if (!el) throw new Error(`#${id} not found in UI`);
    return el as HTMLElement;
  }

  private safe(step: string, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      this.fail(step, err);
    }
  }

  private fail(step: string, err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err);
    const full = `UI.${step} failed: ${msg}`;
    console.error(full);
    if (this.reportError) this.reportError(full);
  }

  private build(): HTMLElement {
    const root = document.createElement('div');
    root.id = 'ui-overlay';
    root.innerHTML = `
<div class="game-column">
  <div class="top-bar" data-ui>
    <div class="player-badge" id="ui-player-badge">TW</div>
    <div class="top-center">
      <div class="pill"><span class="icon">&#127760;</span><span id="ui-gems">0</span></div>
      <div class="pill"><span class="icon">&#128176;</span><span id="ui-credits">0</span></div>
    </div>
    <div class="top-right">
      <button class="icon-btn" title="Mail">&#128228;</button>
      <button class="icon-btn" title="Settings">&#9881;</button>
      <button class="icon-btn" id="ui-reset-save" title="Dev menu">&#128465;</button>
    </div>
  </div>

  <div class="planet-header">
    <div class="planet-name-row">
      <div class="planet-name" id="ui-planet-name">Verdant</div>
    </div>
    <div class="progress-line" id="ui-progress-line"></div>
    <div class="goal-text" id="ui-goal" data-area-top>Harvest 500 trees (0/500)</div>
  </div>

  <div class="middle">
    <div class="planet-stage"></div>
  </div>

  <div class="floating" data-ui>
    <div class="floating-col left" data-area-left>
      <button class="fab" title="Daily rewards">&#127941;</button>
      <button class="fab" title="Quests">&#128214;</button>
      <button class="fab" title="Workers">&#128102;</button>
      <button class="fab" title="Tools">&#128187;</button>
    </div>
    <div class="floating-col right" data-area-right>
      <button class="fab" title="Alien chat">&#128172;</button>
      <button class="fab" title="Focus camera">&#128065;</button>
      <button class="fab green" id="ui-quick-buy" title="Quick upgrade">&#11088;</button>
    </div>
  </div>

  <div class="stats-row" data-ui data-area-bottom>
    <div class="stat">Income <span class="value" id="ui-income">0/s</span></div>
    <div class="stat">Wood <span class="value" id="ui-wood">0</span></div>
    <div class="stats-actions">
      <button class="btn-speed" id="ui-speed">2X SPEED</button>
      <button class="btn-auto" id="ui-auto">AUTO BUY</button>
    </div>
  </div>

  <div class="upgrade-panel" data-ui id="ui-upgrade-panel"></div>

  <div class="bottom-nav" data-ui>
    <div class="nav-tab"><div class="icon">&#127919;</div><div>Prestige</div></div>
    <div class="nav-tab"><div class="icon">&#128102;</div><div>Workers</div></div>
    <div class="nav-tab active"><div class="icon">&#127751;</div><div>Planet</div></div>
    <div class="nav-tab"><div class="icon">&#128172;</div><div>Aliens</div></div>
    <div class="nav-tab"><div class="icon">&#127754;</div><div>Shop</div></div>
  </div>
</div>
`;
    return root;
  }

  private initProgressDots(): void {
    const line = this.elProgressLine;
    for (let i = 1; i <= 5; i++) {
      const dot = document.createElement('div');
      dot.className = 'dot';
      dot.title = `Milestone ${i * 100}`;
      if (i === 5) {
        dot.className = 'dot locked lock';
        dot.title = 'Planet 2: Rocky';
        const icon = document.createElement('span');
        icon.className = 'icon';
        icon.textContent = '🔒';
        dot.appendChild(icon);
      }
      this.progressDots.push(dot);
      line.appendChild(dot);
      if (i < 5) {
        const ln = document.createElement('div');
        ln.className = 'line';
        this.progressLines.push(ln);
        line.appendChild(ln);
      }
    }
  }

  private bindToggles(): void {
    this.safe('query element refs', () => {
      this.elCredits = this.el('ui-credits');
      this.elGems = this.el('ui-gems');
      this.elIncome = this.el('ui-income');
      this.elWood = this.el('ui-wood');
      this.elPlanetName = this.el('ui-planet-name');
      this.elGoal = this.el('ui-goal');
      this.elProgressLine = this.el('ui-progress-line');
      this.elSpeedBtn = this.el('ui-speed');
      this.elAutoBtn = this.el('ui-auto');
      this.elUpgradePanel = this.el('ui-upgrade-panel');
    });

    this.safe('speed/auto click listeners', () => {
      this.elSpeedBtn.addEventListener('click', () => {
        this.speedActive = !this.speedActive;
        this.elSpeedBtn.classList.toggle('active', this.speedActive);
        this.devHandlers.onToggleSpeed?.();
      });
      this.elAutoBtn.addEventListener('click', () => {
        this.autoActive = !this.autoActive;
        this.elAutoBtn.classList.toggle('active', this.autoActive);
        this.devHandlers.onToggleAuto?.();
      });
    });

    // Build upgrade cards once (no innerHTML after startup)
    this.safe('upgrade cards', () => {
      for (const s of CARD_SPECS) {
        const card = document.createElement('div');
        card.className = 'upgrade-card';
        card.id = `ui-card-${s.id}`;

        const nameDiv = document.createElement('div');
        nameDiv.className = 'card-name';
        nameDiv.textContent = s.label;
        card.appendChild(nameDiv);

        const valDiv = document.createElement('div');
        valDiv.className = 'card-value';
        valDiv.id = `ui-val-${s.id}`;
        valDiv.textContent = '0';
        card.appendChild(valDiv);

        const btn = document.createElement('button');
        btn.className = 'upgrade-btn';
        btn.id = `ui-btn-${s.id}`;
        btn.dataset.id = s.id;

        const span = document.createElement('span');
        span.textContent = 'UPGRADE';
        btn.appendChild(span);

        const costSpan = document.createElement('span');
        costSpan.className = 'coin';
        costSpan.id = `ui-cost-${s.id}`;
        costSpan.textContent = '\u{1F4B0} 0';
        btn.appendChild(costSpan);

        card.appendChild(btn);
        this.elUpgradePanel.appendChild(card);

        this.cardBtns.set(s.id, btn);
        this.cardVals.set(s.id, valDiv);
        this.cardCosts.set(s.id, costSpan);

        btn.onclick = () => {
          const id = s.id;
          const role = HIRE_ROLES[id];
          if (role) {
            this.hireHandlers[role]?.();
          } else if (this.upgradeHandler) {
            this.upgradeHandler(id);
          }
        };
      }
    });
  }

  setHireHandler(role: Role, fn: () => void): void {
    this.hireHandlers[role] = fn;
  }

  setUpgradeHandler(fn: (id: UpgradeId) => void): void {
    this.upgradeHandler = fn;
  }

  isSpeedActive(): boolean {
    return this.speedActive;
  }

  isAutoActive(): boolean {
    return this.autoActive;
  }

  updateUI(state: GameState): void {
    const c = state.currencies.credits;
    const g = state.currencies.gems;

    const creditsText = fmt(c);
    if (creditsText !== this.lastCredits) {
      this.elCredits.textContent = creditsText;
      this.lastCredits = creditsText;
    }

    const gemsText = String(toDecimal(g));
    if (gemsText !== this.lastGems) {
      this.elGems.textContent = gemsText;
      this.lastGems = gemsText;
    }

    const inc = incomePerSecond(state);
    const incomeText = fmt(inc) + '/s';
    if (incomeText !== this.lastIncome) {
      this.elIncome.textContent = incomeText;
      this.lastIncome = incomeText;
    }

    const verdant = state.planets.verdant;
    const woodText = fmt(verdant.resources.wood);
    if (woodText !== this.lastWood) {
      this.elWood.textContent = woodText;
      this.lastWood = woodText;
    }

    this.elPlanetName.textContent = PLANETS.verdant.name;

    const goalText = `Harvest 500 trees (${verdant.treesHarvested}/500)`;
    if (goalText !== this.lastGoal) {
      this.elGoal.textContent = goalText;
      this.lastGoal = goalText;
    }

    // Progress dots (only when harvested changes)
    const harvested = verdant.treesHarvested;
    if (harvested !== this.lastHarvested) {
      this.lastHarvested = harvested;
      for (let i = 1; i <= 5; i++) {
        const unlocked = harvested >= i * 100;
        const dot = this.progressDots[i - 1];
        if (i === 5) {
          dot.className = 'dot locked lock';
        } else {
          dot.className = unlocked ? 'dot' : 'dot locked';
        }
      }
    }

    // Speed / Auto toggle buttons
    if (this.speedActive !== this.lastSpeedActive) {
      this.elSpeedBtn.classList.toggle('active', this.speedActive);
      this.lastSpeedActive = this.speedActive;
    }
    if (this.autoActive !== this.lastAutoActive) {
      this.elAutoBtn.classList.toggle('active', this.autoActive);
      this.lastAutoActive = this.autoActive;
    }

    // Upgrade cards (only patch when value/cost/affordable changes)
    for (const s of CARD_SPECS) {
      const level = state.upgrades[s.id];
      let valueText: string;
      let cost: Decimal;
      let affordable: boolean;
      let role: Role | null = null;

      if (HIRE_ROLES[s.id]) {
        role = HIRE_ROLES[s.id]!;
        const existing = verdant.workers.filter((w) => w.role === role).length;
        valueText = String(existing);
        cost = costOf(role, existing);
        affordable = c.gte(cost);
      } else {
        valueText = String(level);
        cost = upgradeCost(s.id, level);
        affordable = c.gte(cost);
      }

      const costText = `\u{1F4B0} ${fmt(cost)}`;
      const cardState = { value: valueText, cost: costText, affordable };
      const last = this.lastCardValues.get(s.id);
      if (!last || last.value !== cardState.value || last.cost !== cardState.cost || last.affordable !== cardState.affordable) {
        this.lastCardValues.set(s.id, cardState);
        const valEl = this.cardVals.get(s.id)!;
        const costEl = this.cardCosts.get(s.id)!;
        const btn = this.cardBtns.get(s.id)!;
        valEl.textContent = valueText;
        costEl.textContent = costText;
        if (!affordable) {
          btn.classList.add('disabled');
          btn.disabled = true;
        } else {
          btn.classList.remove('disabled');
          btn.disabled = false;
        }
      }
    }
  }

  setDevHandlers(handlers: Partial<Record<string, () => void>>): void {
    this.devHandlers = handlers;
  }

  destroy(): void {
    this.root.remove();
  }
}

function toDecimal(value: number | string | Decimal): Decimal {
  return value instanceof Decimal ? value : new Decimal(value);
}

function fmt(d: number | string | Decimal): string {
  const dec = toDecimal(d);
  const n = dec.toNumber();
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'b';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'm';
  if (n >= 1e3) return (n / 1e3).toFixed(2) + 'k';
  return Math.floor(n).toString();
}

// ============================================================
// Dev menu as native <dialog> (top layer, isolated from UI root)
// ============================================================

let elDevDialog: HTMLDialogElement | null = null;
let elDevPlotCount: HTMLDivElement | null = null;
let elDevFps: HTMLDivElement | null = null;
let devMenuOpen = false;
let devMenuOpenTime = 0;
let uiFrozen = false;
let devStatsTimer: number | null = null;

function stop(e: Event): void {
  e.stopPropagation();
}

function createDevDialog(): void {
  if (elDevDialog) return;

  const dialog = document.createElement('dialog');
  dialog.id = 'dev-menu';
  dialog.className = 'dev-menu';
  dialog.setAttribute('data-ui', '');
  dialog.innerHTML = `
<div class="dev-menu-header">
  <div class="dev-menu-title">Dev menu</div>
  <button type="button" class="dev-close" id="dev-close" title="Close">&#10006;</button>
</div>
<div class="dev-menu-section">
  <button type="button" class="dev-btn" id="dev-fill">Fill planet</button>
  <button type="button" class="dev-btn" id="dev-clear">Clear planet</button>
  <button type="button" class="dev-btn" id="dev-reset">Reset game</button>
</div>
<div class="dev-menu-section">
  <div class="dev-subtitle">Credits</div>
  <button type="button" class="dev-btn" id="dev-credits-1000">+1000 credits</button>
  <button type="button" class="dev-btn" id="dev-credits-10000">+10000 credits</button>
</div>
<div class="dev-menu-section">
  <div class="dev-subtitle">Spawn worker</div>
  <button type="button" class="dev-btn" id="dev-spawn-planter">Spawn planter</button>
  <button type="button" class="dev-btn" id="dev-spawn-lumberjack">Spawn lumberjack</button>
  <button type="button" class="dev-btn" id="dev-spawn-carrier">Spawn carrier</button>
</div>
<div class="dev-menu-section">
  <div class="dev-subtitle">Speed</div>
  <button type="button" class="dev-btn dev-speed" id="dev-speed-1">Speed x1</button>
  <button type="button" class="dev-btn dev-speed" id="dev-speed-5">Speed x5</button>
  <button type="button" class="dev-btn dev-speed" id="dev-speed-20">Speed x20</button>
</div>
<div class="dev-menu-section">
  <div class="dev-subtitle">Density</div>
  <button type="button" class="dev-btn dev-density" id="dev-density-600">600 plots</button>
  <button type="button" class="dev-btn dev-density" id="dev-density-1000">1000 plots</button>
  <button type="button" class="dev-btn dev-density" id="dev-density-1500">1500 plots</button>
  <button type="button" class="dev-btn" id="dev-toggle-grid">Show grid</button>
</div>
<div class="dev-menu-section">
  <div class="dev-subtitle">Display</div>
  <button type="button" class="dev-btn dev-toggle" id="dev-toggle-fps">Show FPS</button>
  <button type="button" class="dev-btn dev-toggle" id="dev-toggle-log">Hide debug log</button>
</div>
<div class="dev-menu-section">
  <div class="dev-stat" id="dev-plot-count">Plots: --</div>
  <div class="dev-stat" id="dev-fps">FPS: --</div>
</div>
`;
  document.body.appendChild(dialog);
  elDevDialog = dialog;
  elDevPlotCount = dialog.querySelector('#dev-plot-count')!;
  elDevFps = dialog.querySelector('#dev-fps')!;

  const elDevClose = dialog.querySelector('#dev-close')!;
  const elDevFill = dialog.querySelector('#dev-fill')!;
  const elDevClear = dialog.querySelector('#dev-clear')!;
  const elDevReset = dialog.querySelector('#dev-reset')!;
  const elDevCredits1000 = dialog.querySelector('#dev-credits-1000')!;
  const elDevCredits10000 = dialog.querySelector('#dev-credits-10000')!;
  const elDevSpawnPlanter = dialog.querySelector('#dev-spawn-planter')!;
  const elDevSpawnLumberjack = dialog.querySelector('#dev-spawn-lumberjack')!;
  const elDevSpawnCarrier = dialog.querySelector('#dev-spawn-carrier')!;
  const elDevSpeed1 = dialog.querySelector('#dev-speed-1')!;
  const elDevSpeed5 = dialog.querySelector('#dev-speed-5')!;
  const elDevSpeed20 = dialog.querySelector('#dev-speed-20')!;
  const elDevDensity600 = dialog.querySelector('#dev-density-600')!;
  const elDevDensity1000 = dialog.querySelector('#dev-density-1000')!;
  const elDevDensity1500 = dialog.querySelector('#dev-density-1500')!;
  const elDevToggleGrid = dialog.querySelector('#dev-toggle-grid')!;
  const elDevToggleFps = dialog.querySelector('#dev-toggle-fps')!;
  const elDevToggleLog = dialog.querySelector('#dev-toggle-log')!;

  elDevClose.addEventListener('click', (e) => { stop(e); closeDevDialog(); });
  elDevFill.addEventListener('click', (e) => { stop(e); logEvent('Dev: Fill planet pressed'); (window as any).__fillTrees?.(); showToast('Done: planet filled'); });
  elDevClear.addEventListener('click', (e) => { stop(e); logEvent('Dev: Clear planet pressed'); (window as any).__clearTrees?.(); showToast('Done: planet cleared'); });
  elDevReset.addEventListener('click', (e) => { stop(e); logEvent('Dev: Reset game pressed'); (window as any).__resetGame?.(); });
  elDevCredits1000.addEventListener('click', (e) => { stop(e); logEvent('Dev: +1000 credits pressed'); (window as any).__addCredits?.(1000); showToast('Done: +1000 credits'); });
  elDevCredits10000.addEventListener('click', (e) => { stop(e); logEvent('Dev: +10000 credits pressed'); (window as any).__addCredits?.(10000); showToast('Done: +10000 credits'); });
  elDevSpawnPlanter.addEventListener('click', (e) => { stop(e); logEvent('Dev: Spawn planter pressed'); (window as any).__spawnWorker?.('planter'); showToast('Done: planter spawned'); });
  elDevSpawnLumberjack.addEventListener('click', (e) => { stop(e); logEvent('Dev: Spawn lumberjack pressed'); (window as any).__spawnWorker?.('lumberjack'); showToast('Done: lumberjack spawned'); });
  elDevSpawnCarrier.addEventListener('click', (e) => { stop(e); logEvent('Dev: Spawn carrier pressed'); (window as any).__spawnWorker?.('carrier'); showToast('Done: carrier spawned'); });
  elDevSpeed1.addEventListener('click', (e) => { stop(e); logEvent('Dev: Speed x1 pressed'); (window as any).__setSpeed?.(1); showToast('Done: speed x1'); });
  elDevSpeed5.addEventListener('click', (e) => { stop(e); logEvent('Dev: Speed x5 pressed'); (window as any).__setSpeed?.(5); showToast('Done: speed x5'); });
  elDevSpeed20.addEventListener('click', (e) => { stop(e); logEvent('Dev: Speed x20 pressed'); (window as any).__setSpeed?.(20); showToast('Done: speed x20'); });
  elDevDensity600.addEventListener('click', (e) => { stop(e); logEvent('Dev: Density 600 pressed'); (window as any).__setDensity?.(600); showToast('Done: 600 plots'); });
  elDevDensity1000.addEventListener('click', (e) => { stop(e); logEvent('Dev: Density 1000 pressed'); (window as any).__setDensity?.(1000); showToast('Done: 1000 plots'); });
  elDevDensity1500.addEventListener('click', (e) => { stop(e); logEvent('Dev: Density 1500 pressed'); (window as any).__setDensity?.(1500); showToast('Done: 1500 plots'); });
  elDevToggleGrid.addEventListener('click', (e) => { stop(e); logEvent('Dev: Toggle grid pressed'); (window as any).__toggleGrid?.(); });
  elDevToggleFps.addEventListener('click', (e) => { stop(e); logEvent('Dev: Toggle FPS pressed'); (window as any).__toggleFps?.(); });
  elDevToggleLog.addEventListener('click', (e) => { stop(e); logEvent('Dev: Toggle debug log pressed'); (window as any).__toggleLog?.(); });

  // Stop propagation on all pointer/touch events inside dialog
  for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'touchstart', 'touchmove', 'click']) {
    dialog.addEventListener(ev, stop, true);
  }

  // Dialog lifecycle events
  dialog.addEventListener('cancel', (e) => {
    logEvent('DIALOG cancel event (Escape/backdrop)');
    e.preventDefault();
  });
  dialog.addEventListener('close', () => {
    logEvent('DIALOG close event');
    devMenuOpen = false;
    uiFrozen = false;
    if (devStatsTimer) { clearTimeout(devStatsTimer); devStatsTimer = null; }
    logEvent(`Dev menu closed after ${((Date.now() - devMenuOpenTime) / 1000).toFixed(1)}s`);
    // Reset zoom to default when menu closes
    (window as any).__resetZoomToDefault?.();
  });
}

function openDevDialog(): void {
  createDevDialog();
  if (!elDevDialog) return;
  devMenuOpen = true;
  uiFrozen = true;
  devMenuOpenTime = Date.now();
  logEvent('Dev menu opened');
  logStack('openDevDialog called from');
  elDevDialog.showModal();
  updateDevStats();
  startDevStatsTimer();
}

function closeDevDialog(): void {
  if (!devMenuOpen || !elDevDialog) return;
  logStack('closeDevDialog called from');
  elDevDialog.close();
  devMenuOpen = false;
  uiFrozen = false;
  if (devStatsTimer) { clearTimeout(devStatsTimer); devStatsTimer = null; }
  logEvent('Dev menu closed via X button');
  (window as any).__resetZoomToDefault?.();
}

function startDevStatsTimer(): void {
  if (devStatsTimer) clearTimeout(devStatsTimer);
  const tick = () => {
    if (!devMenuOpen) return;
    updateDevStats();
    devStatsTimer = window.setTimeout(tick, 1000);
  };
  devStatsTimer = window.setTimeout(tick, 1000);
}

function updateDevStats(plotCount?: number, fps?: number): void {
  if (elDevPlotCount && plotCount !== undefined) {
    elDevPlotCount.textContent = `Plots: ${plotCount}`;
  } else if (elDevPlotCount) {
    // Read from window global if available
    const plots = (window as any).__plotCount;
    if (plots !== undefined) elDevPlotCount.textContent = `Plots: ${plots}`;
  }
  if (elDevFps && fps !== undefined) {
    elDevFps.textContent = `FPS: ${fps}`;
  } else if (elDevFps) {
    const fpsVal = (window as any).__debugFPS;
    if (fpsVal !== undefined) elDevFps.textContent = `FPS: ${fpsVal}`;
  }
}

// ============================================================
// Toast
// ============================================================

let toastEl: HTMLDivElement | null = null;
let toastTimer: number | null = null;

function showToast(msg: string): void {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.id = 'ui-toast';
    toastEl.style.cssText = `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:2147483647;background:rgba(0,0,0,0.8);color:#fff;padding:12px 24px;border-radius:8px;border:1px solid #3ecf8e;font-size:14px;font-weight:600;pointer-events:none;display:none;white-space:nowrap;`;
    document.body.appendChild(toastEl);
  }
  toastEl!.textContent = msg;
  toastEl!.style.display = 'block';
  if (toastTimer) { clearTimeout(toastTimer); }
  toastTimer = window.setTimeout(() => { toastEl!.style.display = 'none'; }, 1200);
}

// ============================================================
// URL parameters
// ============================================================

export function applyUrlParams(): void {
  const params = new URLSearchParams(window.location.search);
  const fill = params.get('fill');
  const clear = params.get('clear');
  const density = params.get('density');
  const menu = params.get('menu');
  const reset = params.get('reset');

  logEvent(`Page load #${loadCounter}`);
  logEvent(`URL params: fill=${fill}, clear=${clear}, density=${density}, menu=${menu}, reset=${reset}`);

  if (reset === '1') {
    logEvent('URL: reset save');
    (window as any).__resetGame?.();
    return;
  }

  if (density) {
    logEvent(`URL: set density ${density}`);
    (window as any).__setDensity?.(parseInt(density, 10));
  }

  if (fill === '1') {
    logEvent('URL: fill planet');
    (window as any).__fillTrees?.();
  }

  if (clear === '1') {
    logEvent('URL: clear planet');
    (window as any).__clearTrees?.();
  }

  if (menu === '1') {
    logEvent('URL: open dev menu');
    openDevDialog();
  }
}

export {
  logEvent,
  logStack,
  startMutationObserver,
  startDiagnosticEvents,
  uiFrozen,
  openDevDialog,
  closeDevDialog,
  updateDevStats,
  showToast,
};
