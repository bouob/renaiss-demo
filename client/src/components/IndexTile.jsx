/**
 * Renaiss OS Index summary — compact HUD layout (Dokipoki-like).
 * Level left, 7d/30d right, sparkline full width. No stretch void.
 */
import { useTranslation } from 'react-i18next';
import InteractiveTrendChart from './InteractiveTrendChart.jsx';
import InfoHint from './InfoHint.jsx';
import IndexBasketArt from './IndexBasketArt.jsx';

const WINDOW_DAYS = { d7: 7, d30: 30, d365: 365 };

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

function sliceTrailing(points, days) {
  if (!Array.isArray(points)) return [];
  if (!Number.isFinite(days) || days <= 0) return points;
  return points.slice(-(Math.trunc(days) + 1));
}

export default function IndexTile({ index, dateLocale = 'en-US', windowKey = 'd30' }) {
  const { t } = useTranslation();
  if (!index) return null;

  const windowDays = WINDOW_DAYS[windowKey] ?? 30;
  const delta = deltasSafe(index.deltas?.[windowKey]);
  const sparkline = sliceTrailing(index.sparkline, windowDays);
  const level = index.value;
  const title = index.label || index.game || t('index.pokemonLabel');
  const chartData = sparkline.map(({ t: pointDate, usdCents }) => ({ t: pointDate, index: usdCents }));

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
          <DeltaStat label={t(`index.change${windowDays}d`, { defaultValue: t(`index.${windowKey}`) })} value={delta} />
        </div>
      </div>

      <div className="index-chart-frame">
        <InteractiveTrendChart
          data={chartData}
          series={[{ key: 'index', name: title, color: '#00f0ff' }]}
          dateLocale={dateLocale}
          formatValue={(value) => formatLevel(value, dateLocale)}
          ariaLabel={t('benchmark.tabIndex')}
        />
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
        <div className="index-methodology-note">
          <span>{t('index.methodologyLabel')}</span>
          <InfoHint
            label={t('index.methodologyText')}
            placement="top"
            art={<IndexBasketArt />}
          />
        </div>
      </div>
    </div>
  );
}
