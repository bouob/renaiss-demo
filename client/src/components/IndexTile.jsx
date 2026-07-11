/**
 * Renaiss OS Index summary — layout aligned with Dokipoki RenaissIndexTile:
 * big level left, 7d/30d deltas right, sparkline, source link.
 */
import { useTranslation } from 'react-i18next';
import Sparkline from './Sparkline.jsx';
import { RENAISS_INDEX_BASE_URL } from '../lib/renaissIndexUrl.js';

function formatPct(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)}%`;
}

function formatLevel(value, locale) {
  if (!Number.isFinite(value)) return '—';
  try {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
  } catch {
    return value.toFixed(2);
  }
}

function DeltaStat({ label, value }) {
  const up = Number.isFinite(value) ? value >= 0 : null;
  const colorClass = !Number.isFinite(value) ? '' : up ? 'text-pos' : 'text-neg';
  return (
    <div className="index-delta-stat">
      <div className="index-delta-label">{label}</div>
      <div className={`index-delta-value ${colorClass}`}>
        {Number.isFinite(value) && (
          <span className="index-delta-arrow" aria-hidden="true">{up ? '↑' : '↓'}</span>
        )}
        {formatPct(value)}
      </div>
    </div>
  );
}

export default function IndexTile({ index, dateLocale = 'en-US' }) {
  const { t } = useTranslation();
  if (!index) return null;

  const d7 = deltasSafe(index.deltas?.d7);
  const d30 = deltasSafe(index.deltas?.d30);
  const d365 = deltasSafe(index.deltas?.d365);
  const attributionUrl = index.attributionUrl || RENAISS_INDEX_BASE_URL;
  const level = index.value;

  return (
    <div className="index-tile-inner">
      <div className="index-tile-top">
        <div>
          <p className="label">{index.label || index.game || t('index.pokemonLabel')}</p>
          <p className="index-level">{formatLevel(level, dateLocale)}</p>
          <p className="index-level-caption">{t('index.levelLabel')}</p>
        </div>
        <div className="index-deltas">
          <DeltaStat label={t('index.change7d', { defaultValue: t('index.d7') })} value={d7} />
          <DeltaStat label={t('index.change30d', { defaultValue: t('index.d30') })} value={d30} />
          {Number.isFinite(d365) && (
            <DeltaStat label={t('index.d365')} value={d365} />
          )}
        </div>
      </div>

      <Sparkline points={index.sparkline} height={120} />

      <div className="index-tile-foot">
        <p className="small" style={{ margin: 0 }}>
          {index.constituentCount != null
            ? t('index.constituents', { count: index.constituentCount })
            : null}
          {index.updatedAt
            ? ` · ${t('index.updated', { when: new Date(index.updatedAt).toLocaleString(dateLocale) })}`
            : null}
        </p>
        <a
          className="index-source-link"
          href={attributionUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t('index.sourcePrefix')} {t('index.sourceLabel')} ↗
        </a>
      </div>
    </div>
  );
}

function deltasSafe(v) {
  return Number.isFinite(v) ? v : null;
}
