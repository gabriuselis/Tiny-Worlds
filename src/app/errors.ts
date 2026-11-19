import { ERROR_REPEAT_LOG_INTERVAL_MS } from './constants';

const MAX_TRACKED_ERRORS = 200;

interface ErrorRecord {
  lastLogged: number;
  suppressed: number;
}

export interface StageGuardOptions {
  now?: () => number;
  log?: (message: string, err: unknown) => void;
  repeatIntervalMs?: number;
}

export type StageGuard = (stage: string, fn: () => void) => boolean;

// Runs a loop stage; a throw is logged once per distinct stage+message, then repeats
// are counted and reported at most once per interval. Returns false if the stage threw.
export function createStageGuard(options: StageGuardOptions = {}): StageGuard {
  const now = options.now ?? (() => performance.now());
  const log = options.log ?? ((message, err) => console.error(message, err));
  const repeatIntervalMs = options.repeatIntervalMs ?? ERROR_REPEAT_LOG_INTERVAL_MS;
  const records = new Map<string, ErrorRecord>();

  return (stage, fn) => {
    try {
      fn();
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const key = `${stage}\u0000${message}`;
      const t = now();
      const record = records.get(key);
      if (!record) {
        if (records.size >= MAX_TRACKED_ERRORS) records.clear();
        records.set(key, { lastLogged: t, suppressed: 0 });
        log(`[${stage}] ${message}`, err);
      } else if (t - record.lastLogged >= repeatIntervalMs) {
        const repeats = record.suppressed + 1;
        record.lastLogged = t;
        record.suppressed = 0;
        log(`[${stage}] ${message} (repeated ${repeats} more time${repeats === 1 ? '' : 's'})`, err);
      } else {
        record.suppressed++;
      }
      return false;
    }
  };
}

let errorBox: HTMLDivElement;

export function showError(msg: string, err?: unknown): void {
  let stack = '';
  if (err instanceof Error) {
    stack = err.stack ? err.stack.split('\n').slice(0, 3).join('\n') : '';
  }
  errorBox.textContent = `ERROR: ${msg}${stack ? '\n' + stack : ''}`;
  errorBox.style.borderColor = '#ff0000';
  errorBox.style.color = '#ff0000';
  errorBox.style.display = 'block';
  console.error('ERROR', msg, err);
}

export function installErrorHandling(): void {
  errorBox = document.createElement('div');
  errorBox.id = 'error-box';
  errorBox.style.cssText = `position:fixed;top:8px;left:8px;right:8px;z-index:99999;pointer-events:none;font-family:monospace;font-size:11px;color:#ff4d4d;background:rgba(0,0,0,0.85);padding:8px 10px;border-radius:6px;border:2px solid #ff4d4d;line-height:1.4;max-width:96vw;white-space:pre-wrap;word-break:break-all;display:none;`;
  document.body.appendChild(errorBox);

  window.addEventListener('error', (e) => {
    showError(`window.error: ${e.message} at ${e.filename}:${e.lineno}:${e.colno}`, e.error);
  });
  window.addEventListener('unhandledrejection', (e) => {
    showError(`unhandledrejection: ${String(e.reason)}`, e.reason);
  });

  // Signal to the inline boot script that main.ts has started
  (window as any).__mainStarted?.();
}
