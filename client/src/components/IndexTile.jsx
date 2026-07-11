/**
 * Renaiss OS Index summary — compact HUD layout (Dokipoki-like).
 * Level left, 7d/30d right, sparkline full width. No stretch void.
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

function deltasSafe(v) {
  return Number.isFinite(v) ? v : null;
}

export default function IndexTile({ index, dateLocale = 'en-US' }) {
  const { t } = useTranslation();
  if (!index) return null;

  const d7 = deltasSafe(index.deltas?.d7);
  const d30 = deltasSafe(index.deltas?.d30);
  const attributionUrl = index.attributionUrl || RENAISS_INDEX_BASE_URL;
  const level = index.value;
  const title = index.label || index.game || t('index.pokemonLabel');

  return (
    <div className="index-tile-inner">
      <div className="index-tile-header">
        <p className="label index-tile-kicker">{title}</p>
      </div>

      <div className="index-tile-top">
        <div className="index-level-block">
          <p className="index-level">{formatLevel(level, dateLocale)}</p>
          <p className="index-level-caption">{t('index.levelLabel')}</p>
        </div>
        <div className="index-deltas">
          <DeltaStat label={t('index.change7d', { defaultValue: t('index.d7') })} value={d7} />
          <DeltaStat label={t('index.change30d', { defaultValue: t('index.d30') })} value={d30} />
        </div>
      </div>

      <div className="index-chart-frame">
        <Sparkline points={index.sparkline} height={132} width={480} />
      </div>

      <div className="index-tile-foot">
        <p className="small index-tile-meta" style={{ margin: 0 }}>
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
