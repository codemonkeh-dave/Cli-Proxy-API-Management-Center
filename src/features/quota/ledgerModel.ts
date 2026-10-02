import type {
  AntigravityQuotaState,
  ClaudeQuotaState,
  CodexQuotaState,
  DevinQuotaState,
  KimiQuotaState,
  MetaQuotaState,
  XaiQuotaState,
} from '@/types';
import type { QuotaCardState } from './providers';
import type { QuotaProviderType } from './providers/types';

export interface LedgerMetric {
  id: string;
  label: string;
  labelKey?: string;
  labelParams?: Record<string, string | number>;
  remaining: number | null;
  resetAtMs?: number | null;
  periodHours?: number | null;
}

const percent = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;

const remainingFromUsed = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? percent(100 - value) : null;

/** Quota observations only. Unknown capacity stays unknown, including a healthy paid API account. */
export function ledgerMetrics(provider: QuotaProviderType, quota?: QuotaCardState): LedgerMetric[] {
  if (quota?.status !== 'success') return [];
  if (provider === 'claude' || provider === 'codex') {
    const windows = (quota as ClaudeQuotaState | CodexQuotaState).windows;
    const metrics = windows.map((window) => ({
      ...window,
      remaining: remainingFromUsed(window.usedPercent),
    }));
    // Match the reference: the model-specific weekly window leads, then the session and account limits.
    return provider === 'claude'
      ? metrics.sort(
          (a, b) => Number(b.id === 'seven-day-fable') - Number(a.id === 'seven-day-fable')
        )
      : metrics;
  }
  if (provider === 'devin') {
    return (quota as DevinQuotaState).windows.map((window) => ({
      ...window,
      label: window.label ?? window.id,
      labelKey: `devin_quota.${window.id}`,
      remaining: percent(window.remainingPercent),
    }));
  }
  if (provider === 'antigravity') {
    return (quota as AntigravityQuotaState).groups.flatMap((group) =>
      group.buckets.map((bucket) => ({
        ...bucket,
        id: `${group.id}:${bucket.id}`,
        label: `${group.label} · ${bucket.label}`,
        remaining: percent(bucket.remainingFraction * 100),
      }))
    );
  }
  if (provider === 'kimi') {
    return (quota as KimiQuotaState).rows.map((row) => ({
      ...row,
      label: row.label ?? row.id,
      remaining:
        row.limit > 0
          ? percent(((row.limit - row.used) / row.limit) * 100)
          : row.used > 0
            ? 0
            : null,
    }));
  }
  if (provider === 'meta') {
    return ((quota as MetaQuotaState).data?.windows ?? []).map((window) => ({
      id: window.id,
      label: window.id,
      labelKey: `meta_quota.${window.id}`,
      remaining: remainingFromUsed(window.usedPercent),
      resetAtMs: window.resetAt == null ? null : window.resetAt * 1000,
      periodHours: window.id === 'weekly' ? 168 : (window.durationMinutes ?? 0) / 60,
    }));
  }
  const billing = (quota as XaiQuotaState).billing;
  if (!billing || billing.mode === 'paid-health' || billing.periodType !== 'weekly') return [];
  return [
    {
      id: 'weekly',
      label: 'Weekly limit',
      labelKey: 'xai_quota.weekly_limit',
      remaining: remainingFromUsed(billing.usagePercent),
      resetAtMs: billing.resetAtMs,
      periodHours: 168,
    },
  ];
}

export interface LedgerAggregate {
  metric: LedgerMetric;
  values: (number | null)[];
  knownCount: number;
  total: number | null;
  capacity: number;
  nextResetAtMs: number | null;
}

/** Aggregate the same limit across accounts. Never add unlike windows or assume unloaded accounts are full. */
export function aggregateLedgerMetrics(
  observations: readonly LedgerMetric[][],
  nowMs: number
): LedgerAggregate[] {
  const definitions = new Map<string, LedgerMetric>();
  observations.forEach((metrics) =>
    metrics.forEach((metric) => {
      if (!definitions.has(metric.id)) definitions.set(metric.id, metric);
    })
  );
  return [...definitions.values()]
    .map((metric) => {
      const matches = observations.map((metrics) => metrics.find((item) => item.id === metric.id));
      const values = matches.map((match) => percent(match?.remaining));
      const known = values.filter((value): value is number => value !== null);
      const resets = matches.flatMap((match) =>
        match &&
        match.remaining !== null &&
        match.remaining < 100 &&
        typeof match.resetAtMs === 'number' &&
        Number.isFinite(match.resetAtMs) &&
        match.resetAtMs > nowMs
          ? [match.resetAtMs]
          : []
      );
      return {
        metric,
        values,
        knownCount: known.length,
        total: known.length ? known.reduce((sum, value) => sum + value, 0) : null,
        capacity: known.length * 100,
        nextResetAtMs: resets.length ? Math.min(...resets) : null,
      };
    })
    .sort((a, b) => {
      const priority = (metric: LedgerMetric) =>
        metric.id === 'seven-day-fable' ? 0 : (metric.periodHours ?? 0) >= 168 ? 1 : 2;
      return priority(a.metric) - priority(b.metric);
    });
}

/** Mask both the visible label and its tooltip without changing credential identity or request keys. */
export function maskQuotaEmail(name: string): string {
  return name.replace(
    /([^@\s]+)@([^\s.]+)(\.[^\s]+)/g,
    (_match, local: string, domain: string, suffix: string) => {
      const dash = local.lastIndexOf('-');
      const prefix = dash >= 0 ? local.slice(0, dash + 1) : '';
      const mailbox = local.slice(dash + 1);
      return `${prefix}${mailbox.slice(0, 1)}•••@${domain.slice(0, 1)}•••${suffix}`;
    }
  );
}
