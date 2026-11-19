import { describe, it, expect } from 'vitest';
import { createStageGuard } from '../src/app/errors';

function setup(repeatIntervalMs = 1000) {
  let t = 0;
  const logs: string[] = [];
  const guard = createStageGuard({
    now: () => t,
    log: (m) => logs.push(m),
    repeatIntervalMs,
  });
  return { guard, logs, advance: (ms: number) => { t += ms; } };
}

const boom = (msg: string) => () => { throw new Error(msg); };

describe('stage guard', () => {
  it('returns true and logs nothing when the stage succeeds', () => {
    const { guard, logs } = setup();
    expect(guard('sim', () => {})).toBe(true);
    expect(logs).toEqual([]);
  });

  it('logs a distinct error once with its stage name and keeps going', () => {
    const { guard, logs } = setup();
    expect(guard('sim', boom('bad'))).toBe(false);
    expect(guard('sim', boom('bad'))).toBe(false);
    expect(guard('sim', boom('bad'))).toBe(false);
    expect(logs).toEqual(['[sim] bad']);
  });

  it('reports the suppressed repeat count after the interval', () => {
    const { guard, logs, advance } = setup(1000);
    guard('sim', boom('bad'));
    guard('sim', boom('bad'));
    guard('sim', boom('bad'));
    advance(1000);
    guard('sim', boom('bad'));
    expect(logs).toEqual(['[sim] bad', '[sim] bad (repeated 3 more times)']);
    guard('sim', boom('bad'));
    expect(logs).toHaveLength(2);
  });

  it('treats different stages and messages as distinct errors', () => {
    const { guard, logs } = setup();
    guard('sim', boom('bad'));
    guard('ufo', boom('bad'));
    guard('sim', boom('worse'));
    expect(logs).toEqual(['[sim] bad', '[ufo] bad', '[sim] worse']);
  });

  it('handles non-Error throws', () => {
    const { guard, logs } = setup();
    guard('ui', () => { throw 'oops'; });
    expect(logs).toEqual(['[ui] oops']);
  });
});
