/**
 * Path A — adaptive poll cadence. `healthyDelayMs` is the pure core of the
 * ingestor's healthy-path backoff: climb the warm-up rungs after activity, then
 * settle at the configured idle ceiling. The ladder values are a product
 * decision (5s → 10s → 30s → 60s at the default ceiling); this locks them in and
 * pins the clamp behavior the e2e harness relies on (POLL_INTERVAL_MS=3s → flat).
 */
import { describe, expect, it } from 'vitest';
import { healthyDelayMs } from '../src/ingestor';

describe('healthyDelayMs — adaptive poll ladder', () => {
  it('climbs 5s → 10s → 30s → ceiling as the idle streak grows (default 60s ceiling)', () => {
    expect(healthyDelayMs(0, 60_000)).toBe(5_000);
    expect(healthyDelayMs(1, 60_000)).toBe(10_000);
    expect(healthyDelayMs(2, 60_000)).toBe(30_000);
    expect(healthyDelayMs(3, 60_000)).toBe(60_000);
    expect(healthyDelayMs(99, 60_000)).toBe(60_000);
  });

  it('flattens to the ceiling when it sits below the rungs (e2e sets POLL_INTERVAL_MS=3s)', () => {
    for (const streak of [0, 1, 2, 3, 9]) {
      expect(healthyDelayMs(streak, 3_000)).toBe(3_000);
    }
  });

  it('settles at a raised ceiling above the top rung', () => {
    expect(healthyDelayMs(2, 120_000)).toBe(30_000); // warm-up rung unchanged
    expect(healthyDelayMs(3, 120_000)).toBe(120_000); // settles at the raised ceiling
  });

  it('clamps a warm-up rung that sits above a mid ceiling', () => {
    expect(healthyDelayMs(0, 8_000)).toBe(5_000); // 5s rung < 8s ceiling
    expect(healthyDelayMs(1, 8_000)).toBe(8_000); // 10s rung clamped to 8s ceiling
  });
});
