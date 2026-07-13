import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { rebaseToShared, computeAlpha } from '../lib/benchmarkSeries.js';
import InteractiveTrendChart from './InteractiveTrendChart.jsx';

const PORTFOLIO_STROKE = '#7dd3fc'; // inventory line
const INDEX_STROKE = '#a78bfa';     // index line

function formatSignedPct(n) {
  if (!Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

const WINDOW_DAYS = { d7: 7, d30: 30, d365: 365 };

export default function BenchmarkVsChart({ portfolio, index, benchmark, coverage, windowKey = 'd30', dateLocale = 'en-US' }) {
  const { t } = useTranslation();
  const [modalOpen, setModalOpen] = useState(false);
  const windowDays = WINDOW_DAYS[windowKey] ?? 30;

  const rebased = useMemo(
    () => rebaseToShared(portfolio, index?.sparkline, { windowDays }),
    [portfolio, index, windowDays],
  );

  if (!rebased) {
    return <div className="empty">{t('benchmark.vsNoBenchmark')}</div>;
  }

  const { portfolioRebased, indexRebased } = rebased;
  const fallbackAlpha = computeAlpha(portfolioRebased, indexRebased);
  const windowAlpha = benchmark?.windows?.[windowKey]?.alphaPct;
  const alpha = Number.isFinite(windowAlpha) ? windowAlpha * 100 : fallbackAlpha;
  const chartData = portfolioRebased.map((point, indexAtPoint) => ({
    t: point.t,
    portfolio: point.v,
    index: indexRebased[indexAtPoint]?.v,
  }));

  const summaryKey = Math.abs(alpha) < 0.05
    ? 'benchmark.vsMatching'
    : alpha > 0 ? 'benchmark.vsBeating' : 'benchmark.vsTrailing';
  const summary = t(`${summaryKey}Caption`);
  const alphaColor = Math.abs(alpha) < 0.05 ? 'text-muted' : alpha > 0 ? 'text-pos' : 'text-neg';

  return (
    <div className="benchmark-vs">
      <div className="benchmark-vs-head">
        <p className="label" style={{ margin: 0 }}>{t('benchmark.vsTitle')}</p>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setModalOpen(true)}>
          {t('benchmark.learnMore')}
        </button>
      </div>

      <div className="benchmark-vs-performance">
        <p className={`index-level benchmark-vs-alpha ${alphaColor}`}>{formatSignedPct(alpha)}</p>
        <p className="index-level-caption benchmark-vs-summary">{summary}</p>
      </div>

      <div className="index-chart-frame">
        <InteractiveTrendChart
          data={chartData}
          series={[
            { key: 'portfolio', name: t('benchmark.chartPortfolio'), color: PORTFOLIO_STROKE, strokeWidth: 2.5 },
            { key: 'index', name: t('benchmark.chartIndex'), color: INDEX_STROKE, dashed: true },
          ]}
          dateLocale={dateLocale}
          formatValue={(value) => `${Number(value).toFixed(2)}`}
          ariaLabel={t('benchmark.vsTitle')}
        />
      </div>

      <div className="benchmark-legend">
        <span className="benchmark-legend-item">
          <span className="benchmark-swatch" style={{ background: PORTFOLIO_STROKE }} />
          {t('benchmark.chartPortfolio')}
        </span>
        <span className="benchmark-legend-item">
          <span className="benchmark-swatch benchmark-swatch-dashed" style={{ background: INDEX_STROKE }} />
          {t('benchmark.chartIndex')}
        </span>
      </div>

      <p className="small benchmark-vs-note">{t('benchmark.rebasedNote')}</p>
      {coverage && (
        <p className="small benchmark-vs-coverage">
          {t('benchmark.coverage', { included: coverage.included, total: coverage.total })}
        </p>
      )}

      {modalOpen && (
        <div className="modal-backdrop" role="presentation" onClick={() => setModalOpen(false)}>
          <div className="modal-panel" role="dialog" aria-modal="true"
               onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2 className="modal-title">{t('benchmark.modalTitle')}</h2>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setModalOpen(false)}>
                {t('benchmark.modalClose')}
              </button>
            </div>
            <div className="modal-body" style={{ gap: '0.75rem' }}>
              <p className="muted">{t('benchmark.modalP1')}</p>
              <p className="muted">{t('benchmark.modalP2')}</p>
              <p className="muted">{t('benchmark.modalP3')}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
