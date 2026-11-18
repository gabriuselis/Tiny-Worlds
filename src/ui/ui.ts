import Decimal from 'break_infinity.js';
import { PLANETS } from '../core/config/planets';
import { costOf } from '../core/config/workers';
import { upgradeCost, upgradeMaxLevel, plantSpeedMult, chopSpeedMult, woodValueMult } from '../core/config/upgrades';
import { incomePerSecond } from '../core/economy';
import { format, gte } from '../core/money';
import { PLOT_COUNT } from '../core/config/world';
import { logsPerMinute } from '../core/wood';
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
  logBox.style.display = 'none'; // hidden by default; toggleable via dev menu

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

// Cards visible but locked (not yet playable) in this stage; only Planter is hireable.
const LOCKED_CARDS: UpgradeId[] = [];

const HIRE_VALUE_LABEL: Partial<Record<Role, string>> = {
  planter: 'Planters',
  lumberjack: 'Lumberjacks',
  carrier: 'Carriers',
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
  onDevToggleGrid: () => void;
}

type ReportError = (msg: string) => void;

export class UI {
  private root: HTMLElement;
private speedActive = false;
  private autoActive = false;
  private hireHandlers: Partial<Record<Role, () => void>> = {};
  private upgradeHandler: ((id: UpgradeId) => void) | null = null;
  private reportError?: ReportError;

  private elCredits!: HTMLElement;
  private elGems!: HTMLElement;
  private elIncome!: HTMLElement;
  private elWood!: HTMLElement;
  private elWoodRate!: HTMLElement;
  private elLogsWaiting!: HTMLElement;
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
  private lastWoodRate = '';
  private lastLogsWaiting = '';
  private lastGoal = '';
  private lastSpeedActive = false;
  private lastAutoActive = false;

  // Progress dot elements (built once)
  private progressDots: HTMLElement[] = [];
  private progressLines: HTMLElement[] = [];

  // Upgrade card element refs (built once)
private cardBtns = new Map<UpgradeId, HTMLButtonElement>();
  private cardVals = new Map<UpgradeId, HTMLElement>();
  private cardCosts = new Map<UpgradeId, HTMLElement>();
  private cardLabels = new Map<UpgradeId, HTMLElement>();
  private cardUpgradeLines = new Map<UpgradeId, HTMLElement>();
  private lastCardValues = new Map<UpgradeId, { value: string; cost: string; affordable: boolean; line: string; label: string }>();

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
    <div class="stat">Wood <span class="value" id="ui-wood">0</span><span class="wood-rate" id="ui-wood-rate">0/min</span></div>
    <div class="stat">Logs waiting <span class="value" id="ui-logs">0</span></div>
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
        icon.textContent = '\u{1F512}';
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
      this.elWoodRate = this.el('ui-wood-rate');
      this.elLogsWaiting = this.el('ui-logs');
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

        const isHire = !!HIRE_ROLES[s.id];

        if (isHire) {
          // Hire cards: title, "Role: n" count line, UPGRADE button with cost.
          const valDiv = document.createElement('div');
          valDiv.className = 'card-value';
          valDiv.id = `ui-val-${s.id}`;
          valDiv.textContent = '0';
          card.appendChild(valDiv);
          this.cardVals.set(s.id, valDiv);
        } else {
          // Upgrade cards: title, ONE line "Lv n | Now: -29%" (or MAX), button.
          const lineDiv = document.createElement('div');
          lineDiv.className = 'card-upgrade-line';
          lineDiv.id = `ui-upgrade-line-${s.id}`;
          lineDiv.textContent = 'Lv 0 | Now: 0%';
          card.appendChild(lineDiv);
          this.cardUpgradeLines.set(s.id, lineDiv);
        }

        const btn = document.createElement('button');
        btn.className = 'upgrade-btn';
        btn.id = `ui-btn-${s.id}`;
        btn.dataset.id = s.id;

        const span = document.createElement('span');
        span.className = 'btn-label';
        span.id = `ui-btn-label-${s.id}`;
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
        this.cardCosts.set(s.id, costSpan);
        this.cardLabels.set(s.id, span);

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

  /** Quick 1.0 -> 1.25 -> 1.0 pulse on the Wood number. */
  bumpWood(): void {
    try {
      const el = this.elWood;
      el.classList.remove('bump');
      void el.offsetWidth;
      el.classList.add('bump');
      window.setTimeout(() => el.classList.remove('bump'), 220);
    } catch { /* ignore */ }
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

    const creditsText = format(c);
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
    const woodText = fmt(state.wood);
    if (woodText !== this.lastWood) {
      this.elWood.textContent = woodText;
      this.lastWood = woodText;
    }
    const rateText = `${logsPerMinute(state)}/min`;
    if (rateText !== this.lastWoodRate) {
      this.elWoodRate.textContent = rateText;
      this.lastWoodRate = rateText;
    }

    let logsWaiting = 0;
    for (const p of verdant.plots) {
      if (p.state === 'logs') logsWaiting += p.woodLeft ?? 0;
    }
    const logsText = String(logsWaiting);
    if (logsText !== this.lastLogsWaiting) {
      this.elLogsWaiting.textContent = logsText;
      this.lastLogsWaiting = logsText;
    }

    this.elPlanetName.textContent = PLANETS.verdant.name;

    const planted = verdant.plots.filter((p) => p.state !== 'empty').length;
    const goalText = `Planted trees: ${planted}/${PLOT_COUNT}`;
    if (goalText !== this.lastGoal) {
      this.elGoal.textContent = goalText;
      this.lastGoal = goalText;
    }

    // Progress dots (fill by planted share)
    const share = planted / PLOT_COUNT;
    for (let i = 1; i <= 5; i++) {
      const dot = this.progressDots[i - 1];
      if (i === 5) {
        dot.className = 'dot locked lock';
      } else {
        const unlocked = share >= i / 5;
        dot.className = unlocked ? 'dot' : 'dot locked';
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
      const maxLevel = upgradeMaxLevel(s.id);
      const isHire = !!HIRE_ROLES[s.id];

      let valueText: string;
      let cost: Decimal;
      let affordable: boolean;
      let labelText = 'UPGRADE';
      let lineText = '';

      if (isHire) {
        const role = HIRE_ROLES[s.id]!;
        const existing = verdant.workers.filter((w) => w.role === role).length;
        valueText = `${HIRE_VALUE_LABEL[role] ?? role}: ${existing}`;
        cost = costOf(role, existing);
        affordable = gte(c, cost);
      } else {
        valueText = String(level);
        cost = upgradeCost(s.id, level);
        affordable = gte(c, cost);
        if (maxLevel !== undefined && level >= maxLevel) {
          labelText = 'MAX';
          affordable = false;
        } else {
          labelText = 'UPGRADE';
        }
        // One-line summary: "Lv n | Now: -29%" (or "+30%")
        let pct = 0;
        if (s.id === 'plantSpeed') pct = (1 - plantSpeedMult(level)) * 100;
        else if (s.id === 'chopSpeed') pct = (1 - chopSpeedMult(level)) * 100;
        else if (s.id === 'woodValue') pct = (woodValueMult(level) - 1) * 100;
        const sign = pct < 0 ? '' : '+';
        lineText = `Lv ${level} | Now: ${sign}${pct.toFixed(0)}%`;
      }
      if (LOCKED_CARDS.includes(s.id)) affordable = false;

      const costText = `\u{1F4B0} ${format(cost)}`;
      const cardState = { value: valueText, cost: costText, affordable, line: lineText, label: labelText };
      const last = this.lastCardValues.get(s.id);
      if (!last || last.value !== cardState.value || last.cost !== cardState.cost || last.affordable !== cardState.affordable || last.line !== cardState.line || last.label !== cardState.label) {
        this.lastCardValues.set(s.id, cardState);
        const valEl = this.cardVals.get(s.id);
        const costEl = this.cardCosts.get(s.id)!;
        const btn = this.cardBtns.get(s.id)!;
        const labEl = this.cardLabels.get(s.id)!;
        const lineEl = this.cardUpgradeLines.get(s.id);
        if (valEl) valEl.textContent = valueText;
        if (lineEl) lineEl.textContent = lineText;
        costEl.textContent = costText;
        labEl.textContent = labelText;
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
  const trim = (v: number): string => Number(v.toFixed(2)).toString();
  if (n >= 1e9) return trim(n / 1e9) + 'b';
  if (n >= 1e6) return trim(n / 1e6) + 'm';
  if (n >= 1e3) return trim(n / 1e3) + 'k';
  return Math.floor(n).toString();
}

// ============================================================
// Dev menu as a plain <div id="dev-menu"> overlay (not <dialog>)
// ============================================================

let elDevMenu: HTMLDivElement | null = null;
let elDevBackdrop: HTMLDivElement | null = null;
let elDevPlotCount: HTMLDivElement | null = null;
let elDevFps: HTMLDivElement | null = null;
let elDevCoverage: HTMLDivElement | null = null;
let elDevCoverageDetail: HTMLDivElement | null = null;
let elDevResults: HTMLDivElement | null = null;
let devMenuOpen = false;
let devMenuOpenTime = 0;
let uiFrozen = false;
let devStatsTimer: number | null = null;
let devLastInteraction = 0;
let devLastButtonId = '';
let devLastEventType = '';
const DEV_DUPLICATE_MS = 700;

function createDevMenu(): void {
  if (elDevMenu) return;

  const menu = document.createElement('div');
  menu.id = 'dev-menu';
  menu.className = 'dev-menu';
  menu.setAttribute('data-ui', '');
  menu.hidden = true;
  menu.innerHTML = `
<div class="dev-backdrop"></div>
<div class="dev-panel">
  <div class="dev-menu-header">
    <div class="dev-menu-title">Dev menu</div>
    <button type="button" class="dev-close" id="dev-close-top" title="Close">&#10006;</button>
  </div>
  <div class="dev-menu-body">
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
      <div class="dev-subtitle">Upgrades</div>
      <button type="button" class="dev-btn" id="dev-upgrades-plus1">Upgrades +1 all</button>
      <button type="button" class="dev-btn" id="dev-upgrades-reset">Upgrades reset</button>
      <div class="dev-stat" id="dev-upgrade-mult">plant 1.00x | chop 1.00x | value 1.00x</div>
    </div>
    <div class="dev-menu-section">
      <button type="button" class="dev-btn" id="dev-toggle-grid">Show grid</button>
      <button type="button" class="dev-btn" id="dev-surface-check">Surface check</button>
      <button type="button" class="dev-btn" id="dev-plot-dots">Plot dots</button>
      <button type="button" class="dev-btn" id="dev-workers-debug">Workers debug</button>
    </div>
    <div class="dev-menu-section">
      <div class="dev-subtitle">Trees &amp; wood</div>
      <button type="button" class="dev-btn" id="dev-grow-all">Grow all trees</button>
      <button type="button" class="dev-btn" id="dev-spawn-piles">Spawn 10 log piles</button>
      <button type="button" class="dev-btn" id="dev-add-wood">+10 wood</button>
      <button type="button" class="dev-btn" id="dev-test-particles">Emit test particles</button>
      <button type="button" class="dev-btn" id="dev-wood-test">Run wood self-test</button>
    </div>
    <div class="dev-menu-section">
      <div class="dev-subtitle">Display</div>
      <button type="button" class="dev-btn dev-toggle" id="dev-toggle-fps">Show FPS</button>
      <button type="button" class="dev-btn dev-toggle" id="dev-toggle-log">Hide debug log</button>
    </div>
    <div class="dev-menu-section">
      <div class="dev-subtitle">Coverage</div>
      <div id="dev-coverage-detail"></div>
    </div>
    <div class="dev-menu-section">
      <div class="dev-subtitle">Self-test</div>
      <button type="button" class="dev-btn" id="dev-self-test">Run self-test</button>
      <button type="button" class="dev-btn" id="dev-test-tree">Test tree</button>
      <button type="button" class="dev-btn" id="dev-test-worker">Test worker</button>
      <div class="dev-self-results" id="dev-self-results"></div>
    </div>
  </div>
  <div class="dev-menu-footer">
    <div class="dev-stat" id="dev-plot-count">Plots: --</div>
    <div class="dev-stat" id="dev-fps">FPS: --</div>
    <div class="dev-stat" id="dev-coverage">Coverage: --</div>
    <button type="button" class="dev-close" id="dev-close-bottom" title="Close">Close</button>
  </div>
</div>
`;
  document.body.appendChild(menu);
  elDevMenu = menu;
  elDevBackdrop = menu.querySelector('.dev-backdrop')!;
  elDevPlotCount = menu.querySelector('#dev-plot-count')!;
  elDevFps = menu.querySelector('#dev-fps')!;
  elDevCoverage = menu.querySelector('#dev-coverage')!;
  elDevCoverageDetail = menu.querySelector('#dev-coverage-detail')!;
  elDevResults = menu.querySelector('#dev-self-results')!;

  menu.addEventListener('pointerup', onDevMenuEvent, true);
  menu.addEventListener('click', onDevMenuEvent, true);
}

function onDevMenuEvent(e: Event): void {
  const ev = e as PointerEvent | MouseEvent;
  const target = ev.target as HTMLElement | null;
  ev.stopPropagation();

  if (target === elDevMenu || target === elDevBackdrop) {
    closeDevDialog();
    return;
  }

  const btn = target?.closest('button');
  if (!btn) return;
  const id = btn.id;
  const isClose = id === 'dev-close-top' || id === 'dev-close-bottom';
  const now = performance.now();
  // Suppress the duplicate click that follows the pointerup of the SAME tap.
  // A second real tap has the same event type as the first, so it always runs.
  if (
    !isClose &&
    id === devLastButtonId &&
    ev.type !== devLastEventType &&
    now - devLastInteraction < DEV_DUPLICATE_MS
  ) {
    ev.preventDefault();
    return;
  }
  devLastButtonId = id;
  devLastEventType = ev.type;
  devLastInteraction = now;

  const run = (label: string, fn: () => void): void => {
    try {
      fn();
      logEvent(`Dev: ${label} OK`);
      // Actions show their own toast with real numbers; don't overwrite it.
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logEvent(`Dev: ${label} FAILED: ${msg}`);
      showToast(`Fail: ${label}: ${msg}`);
    }
  };

const actions: { [id: string]: () => void } = {
    'dev-fill': () => (window as any).__fillTrees?.(),
    'dev-clear': () => (window as any).__clearTrees?.(),
    'dev-reset': () => (window as any).__resetGame?.(),
    'dev-credits-1000': () => (window as any).__addCredits?.(1000),
    'dev-credits-10000': () => (window as any).__addCredits?.(10000),
    'dev-spawn-planter': () => (window as any).__spawnWorker?.('planter'),
    'dev-spawn-lumberjack': () => (window as any).__spawnWorker?.('lumberjack'),
    'dev-spawn-carrier': () => (window as any).__spawnWorker?.('carrier'),
    'dev-speed-1': () => (window as any).__setSpeed?.(1),
    'dev-speed-5': () => (window as any).__setSpeed?.(5),
    'dev-speed-20': () => (window as any).__setSpeed?.(20),
    'dev-toggle-grid': () => (window as any).__toggleGrid?.(),
    'dev-surface-check': () => (window as any).__surfaceCheck?.(),
    'dev-plot-dots': () => (window as any).__togglePlotDots?.(),
    'dev-workers-debug': () => { const d = (window as any).__getWorkersDebug?.(); if (d) { logEvent(d); showToast(d.split('\n').slice(0, 5).join(' | ')); } },
    'dev-grow-all': () => (window as any).__growAllTrees?.(),
    'dev-spawn-piles': () => (window as any).__spawnLogPiles?.(10),
    'dev-add-wood': () => (window as any).__addWood?.(10),
    'dev-test-particles': () => (window as any).__emitTestParticles?.(),
    'dev-wood-test': () => (window as any).__runWoodSelfTest?.(),
    'dev-toggle-fps': () => (window as any).__toggleFps?.(),
    'dev-toggle-log': () => (window as any).__toggleLog?.(),
    'dev-self-test': runSelfTest,
    'dev-test-tree': () => (window as any).__testTree?.(),
    'dev-test-worker': () => (window as any).__testWorker?.(),
    'dev-upgrades-plus1': () => (window as any).__upgradeAllPlus1?.(),
    'dev-upgrades-reset': () => (window as any).__upgradeReset?.(),
  };

  if (isClose) { closeDevDialog(); return; }
  const fn = actions[id];
  if (fn) run(id, fn);
}

function openDevDialog(): void {
  createDevMenu();
  if (!elDevMenu) return;
  devMenuOpen = true;
  uiFrozen = true;
  devMenuOpenTime = Date.now();
  elDevMenu.hidden = false;
  elDevMenu.setAttribute('open', '');
  logEvent('Dev menu opened');
  logStack('openDevDialog called from');
  updateDevStats();
  startDevStatsTimer();
}

function closeDevDialog(): void {
  if (!devMenuOpen || !elDevMenu) return;
  logStack('closeDevDialog called from');
  elDevMenu.hidden = true;
  elDevMenu.removeAttribute('open');
  devMenuOpen = false;
  uiFrozen = false;
  if (devStatsTimer) { clearTimeout(devStatsTimer); devStatsTimer = null; }
  logEvent(`Dev menu closed after ${((Date.now() - devMenuOpenTime) / 1000).toFixed(1)}s`);
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
    const plots = (window as any).__plotCount;
    if (plots !== undefined) elDevPlotCount.textContent = `Plots: ${plots}`;
  }
  if (elDevFps && fps !== undefined) {
    elDevFps.textContent = `FPS: ${fps}`;
  } else if (elDevFps) {
    const fpsVal = (window as any).__debugFPS;
    if (fpsVal !== undefined) elDevFps.textContent = `FPS: ${fpsVal}`;
  }
  // Coverage debug line (temporary)
  if (elDevCoverage && (window as any).__getCoverageStats) {
    elDevCoverage.textContent = (window as any).__getCoverageStats();
  }
  if (elDevCoverageDetail && (window as any).__getCoverageStats) {
    elDevCoverageDetail.textContent = (window as any).__getCoverageStats();
  }
  // Upgrade multiplier line (dev menu)
  const elMult = document.getElementById('dev-upgrade-mult');
  if (elMult && (window as any).__upgradeMultipliers) {
    const m = (window as any).__upgradeMultipliers();
    elMult.textContent = `plant ${m.plant.toFixed(2)}x | chop ${m.chop.toFixed(2)}x | value ${(m.value * 100).toFixed(0)}%`;
  }
}

interface StateSummary {
  plots: number;
  empty: number;
  planted: number;
  grown: number;
  sapling: number;
  falling?: number;
  logs?: number;
  harvested?: number;
  visible: number;
  workers: number;
  credits: string;
}

let selfTestRunning = false;

// Automated end-to-end check of the dev actions on the shared game object.
function runSelfTest(): void {
  if (selfTestRunning) { showToast('Self-test already running'); return; }
  selfTestRunning = true;

  const summary = (): StateSummary => (window as any).__getStateSummary?.() ?? {
    plots: 0, empty: 0, planted: 0, grown: 0, sapling: 0, visible: 0, workers: 0, credits: '?',
  };
  const wait = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));
  const results: { label: string; ok: boolean }[] = [];
  if (elDevResults) elDevResults.textContent = '';

  const add = (label: string, ok: boolean): void => {
    results.push({ label, ok });
    logEvent(`Self-test: ${label} ${ok ? 'PASS' : 'FAIL'}`);
    if (elDevResults) {
      const line = document.createElement('div');
      line.textContent = `${ok ? 'PASS' : 'FAIL'} - ${label}`;
      line.className = ok ? 'dev-self-pass' : 'dev-self-fail';
      elDevResults.appendChild(line);
    }
  };

  void (async () => {
    try {
      (window as any).__setSpeed?.(1);
      (window as any).__resetGame?.(true);
      await wait(30);
      let s = summary();
      add(`Reset: ${s.planted} trees, ${s.workers} workers`, s.planted === 0 && s.workers === 0);

      (window as any).__fillTrees?.();
      await wait(30);
      s = summary();
      add(`Fill: state ${s.grown} grown, ${s.visible} visible`, s.grown === 1500 && s.visible === 1500);

      (window as any).__clearTrees?.();
      await wait(30);
      s = summary();
      add(`Clear: ${s.visible} visible, ${s.empty} empty`, s.visible === 0);

      (window as any).__setSpeed?.(20);
      (window as any).__spawnWorker?.('planter');
      await wait(10000);
      s = summary();
      add(`Plant (10 s at x20): ${s.workers} worker, ${s.planted} planted`, s.workers === 1 && s.planted >= 1);

      const wood = (window as any).__runWoodSelfTest?.();
      add(`Wood chain (5 min): ${wood?.harvested ?? 0} chopped, ${wood?.logs ?? 0} piles waiting`,
        !!wood && wood.harvested > 0);

      (window as any).__setSpeed?.(1);
      (window as any).__resetGame?.(true);
      await wait(30);
      s = summary();
      add(`Reset again: ${s.planted} trees, ${s.workers} workers, credits ${s.credits}`,
        s.planted === 0 && s.workers === 0 && s.credits === '100');
    } catch (err) {
      add(`Error: ${err instanceof Error ? err.message : String(err)}`, false);
    } finally {
      (window as any).__setSpeed?.(1);
      selfTestRunning = false;
    }

    const passCount = results.filter((r) => r.ok).length;
    const allPass = results.length > 0 && passCount === results.length;
    showToast(`Self-test: ${allPass ? 'PASS' : 'FAIL'} ${passCount}/${results.length}`);
    logEvent(`Self-test result: ${allPass ? 'PASS' : 'FAIL'} ${passCount}/${results.length}`);
  })();
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
  const menu = params.get('menu');
  const reset = params.get('reset');

  logEvent(`Page load #${loadCounter}`);
  logEvent(`URL params: fill=${fill}, clear=${clear}, menu=${menu}, reset=${reset}`);

  if (reset === '1') {
    logEvent('URL: reset save');
    (window as any).__resetGame?.(true);
    return;
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

