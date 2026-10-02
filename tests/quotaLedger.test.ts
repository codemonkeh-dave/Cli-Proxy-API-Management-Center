import { describe, expect, test } from 'bun:test';
import {
  aggregateLedgerMetrics,
  ledgerMetrics,
  maskQuotaEmail,
  type LedgerMetric,
} from '@/features/quota/ledgerModel';
import type { ClaudeQuotaState, KimiQuotaState, MetaQuotaState } from '@/types';
const metric = (remaining: number | null, extra: Partial<LedgerMetric> = {}): LedgerMetric => ({
  id: 'weekly',
  label: 'Weekly',
  remaining,
  periodHours: 168,
  ...extra,
});

describe('quota ledger', () => {
  test('adds matching percentages without confusing usage with remaining quota', () => {
    const result = aggregateLedgerMetrics(
      [58, 100, 100, 51, 100].map((value) => [metric(value)]),
      1000
    );
    expect(result[0].total).toBe(409);
    expect(result[0].capacity).toBe(500);
    const quota: ClaudeQuotaState = {
      status: 'success',
      windows: [
        { id: 'five-hour', label: 'Session', usedPercent: 19, resetLabel: '' },
        { id: 'seven-day-fable', label: 'Fable', usedPercent: 15, resetLabel: '' },
      ],
    };
    expect(ledgerMetrics('claude', quota).map((item) => [item.id, item.remaining])).toEqual([
      ['seven-day-fable', 85],
      ['five-hour', 81],
    ]);
  });
  test('unknown, unloaded and failed accounts never count as full', () => {
    const [result] = aggregateLedgerMetrics([[metric(40)], [], [metric(null)]], 1000);
    expect(result.values).toEqual([40, null, null]);
    expect(result.total).toBe(40);
    expect(result.capacity).toBe(100);
    expect(result.knownCount).toBe(1);
    expect(aggregateLedgerMetrics([[metric(null)]], 1000)[0].total).toBeNull();
    expect(ledgerMetrics('claude', { status: 'error' })).toEqual([]);
    expect(ledgerMetrics('claude')).toEqual([]);
  });
  test('keeps distinct windows separate and chooses only future resets for consumed quota', () => {
    const [weekly, session] = aggregateLedgerMetrics(
      [
        [metric(100, { resetAtMs: 1100 }), metric(30, { id: 'session', periodHours: 5 })],
        [metric(60, { resetAtMs: 3000 })],
        [metric(20, { resetAtMs: 900 })],
      ],
      1000
    );
    expect(weekly.total).toBe(180);
    expect(weekly.nextResetAtMs).toBe(3000);
    expect(session.total).toBe(30);
    expect(session.capacity).toBe(100);
    expect(session.nextResetAtMs).toBeNull();
  });
  test('converts provider units and keeps zero or invalid capacity unknown', () => {
    const kimi: KimiQuotaState = {
      status: 'success',
      rows: [
        { id: 'week', used: 25, limit: 100 },
        { id: 'unknown', used: 0, limit: 0 },
      ],
    };
    expect(ledgerMetrics('kimi', kimi).map((item) => item.remaining)).toEqual([75, null]);
    const meta: MetaQuotaState = {
      status: 'success',
      data: { windows: [{ id: 'weekly', usedPercent: 20, resetAt: 1234 }] },
    };
    expect(ledgerMetrics('meta', meta)[0]).toMatchObject({ remaining: 80, resetAtMs: 1234000 });
    expect(aggregateLedgerMetrics([[metric(NaN)], [metric(Infinity)]], 0)[0].total).toBeNull();
  });
  test('masks email labels while leaving non-email identities intact', () => {
    expect(maskQuotaEmail('claude-alice@example.com.json')).toBe('claude-a•••@e•••.com.json');
    expect(maskQuotaEmail('alice@example.com')).toBe('a•••@e•••.com');
    expect(maskQuotaEmail('account-42.json')).toBe('account-42.json');
  });
});
