import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconRefreshCw } from '@/components/ui/icons';
import { getAuthFileIcon, getTypeLabel } from '@/features/authFiles/constants';
import { useNow } from '@/hooks/useNow';
import type { ClaudeQuotaState, CodexQuotaState, ResolvedTheme } from '@/types';
import { buildResetDisplay, resolveQuotaErrorMessage } from '@/utils/quota';
import { getQuotaDisplayName } from '@/utils/quota/identity';
import { QUOTA_TAB_ORDER } from '../constants';
import {
  aggregateLedgerMetrics,
  ledgerMetrics,
  maskQuotaEmail,
  type LedgerMetric,
} from '../ledgerModel';
import type { QuotaFileEntry } from '../logic';
import { QUOTA_ADAPTERS, type QuotaCardState } from '../providers';
import { QuotaCard, type QuotaCardProps } from './QuotaCard';
import styles from './QuotaLedger.module.scss';

function Meter({ value, label }: { value: number | null; label: string }) {
  const { t } = useTranslation();
  return (
    <div
      className={styles.meter}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value ?? undefined}
      aria-valuetext={
        value === null
          ? t('quota_management.quota_unknown')
          : t('quota_management.quota_remaining', { percent: Math.round(value) })
      }
    >
      <span
        className={
          value === null
            ? styles.unknown
            : value >= 70
              ? styles.high
              : value >= 30
                ? styles.medium
                : styles.low
        }
        style={{ width: `${value ?? 0}%` }}
      />
    </div>
  );
}

function ResetTime({ atMs, remaining }: { atMs?: number | null; remaining: number | null }) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const display = buildResetDisplay(null, atMs, now, i18n.resolvedLanguage);
  return (
    <span className={styles.reset}>
      {display ? (
        <>
          {display.relative && (
            <>
              {display.relative}
              <span aria-hidden="true"> · </span>
            </>
          )}
          {display.absolute}
        </>
      ) : (
        t(
          remaining === 100
            ? 'quota_management.no_reset_pending'
            : 'quota_management.reset_unavailable'
        )
      )}
    </span>
  );
}

function Metric({ metric }: { metric: LedgerMetric }) {
  const { t } = useTranslation();
  const label = metric.labelKey ? t(metric.labelKey, metric.labelParams ?? {}) : metric.label;
  return (
    <div className={styles.metric}>
      <div className={styles.metricHeading}>
        <span>{label}</span>
        <strong>{metric.remaining === null ? '—' : `${Math.round(metric.remaining)}%`}</strong>
      </div>
      <Meter value={metric.remaining} label={label} />
      <ResetTime atMs={metric.resetAtMs} remaining={metric.remaining} />
    </div>
  );
}

export function QuotaProviderSummary({
  entries,
  quotaFor,
  resolvedTheme,
}: {
  entries: QuotaFileEntry[];
  quotaFor: (entry: QuotaFileEntry) => QuotaCardState | undefined;
  resolvedTheme: ResolvedTheme;
}) {
  const { t } = useTranslation();
  const now = useNow();
  const providers = QUOTA_TAB_ORDER.filter((provider) =>
    entries.some((entry) => entry.type === provider)
  );
  if (providers.length === 0) return null;
  return (
    <section className={styles.summaries} aria-label={t('quota_management.provider_summary')}>
      {providers.map((provider) => {
        const group = entries.filter((entry) => entry.type === provider);
        const aggregates = aggregateLedgerMetrics(
          group.map((entry) => ledgerMetrics(provider, quotaFor(entry))),
          now
        );
        const primary = aggregates[0];
        const name = getTypeLabel(t, provider);
        const icon = getAuthFileIcon(provider, resolvedTheme);
        const labelFor = (metric: LedgerMetric) =>
          metric.labelKey ? t(metric.labelKey, metric.labelParams ?? {}) : metric.label;
        return (
          <article key={provider} className={styles.summary}>
            <header className={styles.summaryHeading}>
              <span>
                {icon && <img src={icon} alt="" />}
                <strong>{name}</strong>
              </span>
              <span className={styles.muted}>
                {t('quota_management.meta_credentials', { count: group.length })}
              </span>
            </header>
            <div className={styles.summaryLabel}>
              {primary ? labelFor(primary.metric) : t('quota_management.quota_not_loaded')}
            </div>
            <div
              className={styles.summaryValue}
              title={t('quota_management.aggregate_explanation')}
            >
              <strong>{primary?.total == null ? '—' : `${Math.round(primary.total)}%`}</strong>
              {primary && primary.knownCount > 0 && (
                <span>{t('quota_management.quota_capacity', { capacity: primary.capacity })}</span>
              )}
            </div>
            <div className={styles.segments}>
              {(primary?.values ?? group.map(() => null)).map((value, index) => (
                <Meter
                  key={index}
                  value={value}
                  label={t('quota_management.account_segment', { index: index + 1 })}
                />
              ))}
            </div>
            {primary && (
              <ResetTime
                atMs={primary.nextResetAtMs}
                remaining={
                  primary.total === primary.capacity && primary.knownCount === group.length
                    ? 100
                    : null
                }
              />
            )}
            {primary && primary.knownCount < group.length && (
              <span className={styles.partial}>
                {t('quota_management.partial_quota', {
                  known: primary.knownCount,
                  total: group.length,
                })}
              </span>
            )}
            {aggregates.length > 1 && (
              <footer className={styles.summaryFooter}>
                {aggregates.slice(1).map((aggregate) => (
                  <span key={aggregate.metric.id}>
                    {labelFor(aggregate.metric)}{' '}
                    <strong>
                      {aggregate.total === null ? '—' : `${Math.round(aggregate.total)}%`}
                    </strong>
                    <span className={styles.muted}> / {aggregate.capacity}%</span>
                  </span>
                ))}
              </footer>
            )}
          </article>
        );
      })}
    </section>
  );
}

export function QuotaLedgerRow(props: QuotaCardProps & { hideEmails: boolean }) {
  const { entry, quota, canRefresh, resetting, onRefresh, hideEmails } = props;
  const { t } = useTranslation();
  const [details, setDetails] = useState(false);
  const metrics = ledgerMetrics(entry.type, quota);
  const status = quota?.status ?? 'idle';
  const loading = status === 'loading';
  const rawName = getQuotaDisplayName(entry.file);
  const name = hideEmails ? maskQuotaEmail(rawName) : rawName;
  const plan =
    entry.type === 'claude' || entry.type === 'codex'
      ? (quota as ClaudeQuotaState | CodexQuotaState | undefined)?.planType
      : undefined;
  const planLabel = plan
    ? entry.type === 'claude'
      ? t(`claude_quota.${plan}`)
      : plan
    : getTypeLabel(t, entry.type);
  const prefix = QUOTA_ADAPTERS[entry.type].i18nPrefix;
  return (
    <article className={styles.account}>
      <div className={styles.row}>
        <div className={styles.identity}>
          <strong title={name}>{name}</strong>
          <span>{planLabel}</span>
        </div>
        <div className={styles.metrics} aria-busy={loading}>
          {metrics.length ? (
            metrics.slice(0, 3).map((metric) => <Metric key={metric.id} metric={metric} />)
          ) : (
            <span
              className={status === 'error' ? styles.error : styles.muted}
              role={status === 'error' ? 'alert' : undefined}
            >
              {status === 'error'
                ? t(`${prefix}.load_failed`, {
                    message: resolveQuotaErrorMessage(
                      t,
                      quota?.errorStatus,
                      quota?.error || t('common.unknown_error')
                    ),
                  })
                : loading
                  ? t(`${prefix}.loading`)
                  : t('quota_management.quota_not_loaded')}
            </span>
          )}
        </div>
        <div className={styles.rowActions}>
          <button
            type="button"
            onClick={onRefresh}
            disabled={!canRefresh || loading || resetting}
            className={styles.refresh}
          >
            <IconRefreshCw size={14} />
            <span>{t('auth_files.quota_refresh_single')}</span>
          </button>
          <button
            type="button"
            className={styles.detailsToggle}
            aria-expanded={details}
            onClick={() => setDetails(!details)}
          >
            {t(details ? 'quota_management.hide_details' : 'quota_management.show_details')}
          </button>
        </div>
      </div>
      {details && (
        <div className={styles.details}>
          <QuotaCard {...props} hideEmails={hideEmails} />
        </div>
      )}
    </article>
  );
}
