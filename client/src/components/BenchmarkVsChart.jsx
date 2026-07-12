import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { rebaseToShared, computeAlpha } from '../lib/benchmarkSeries.js';

const W = 480;
const H = 150;
const PAD = 10;
const PORTFOLIO_STROKE = '#7dd3fc'; // inventory line
const INDEX_STROKE = '#a78bfa';     // index line

function pathFrom(series, min, span) {
  const coords = series.map((pt, i) => {
    const x = PAD + (i / Math.max(1, series.length - 1)) * (W - PAD * 2);
    const y = H - PAD - ((pt.v - min) / span) * (H - PAD * 2);
    return `${x},${y}`;
  });
  return `M ${coords.join(' L ')}`;
}

function formatSignedPct(n) {
  if (!Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

export default function BenchmarkVsChart({ portfolio, index, coverage }) {
  const { t } = useTranslation();
  const [modalOpen, setModalOpen] = useState(false);

  const rebased = useMemo(
    () => rebaseToShared(portfolio, index?.sparkline),
    [portfolio, index],
  );

  if (!rebased) {
    return <div className="empty">{t('benchmark.vsNoBenchmark')}</div>;
  }

  const { portfolioRebased, indexRebased } = rebased;
  const alpha = computeAlpha(portfolioRebased, indexRebased);
  const allV = [...portfolioRebased, ...indexRebased].map((p) => p.v);
  const min = Math.min(...allV);
  const max = Math.max(...allV);
  const span = max - min || 1;

  const summaryKey = Math.abs(alpha) < 0.05
    ? 'benchmark.vsMatching'
    : alpha > 0 ? 'benchmark.vsBeating' : 'benchmark.vsTrailing';
  const summary = t(summaryKey, { pct: formatSignedPct(Math.abs(alpha)) });

  return (
    <div className="benchmark-vs">
      <div className="benchmark-vs-head">
        <p className="label" style={{ margin: 0 }}>{t('benchmark.vsTitle')}</p>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setModalOpen(true)}>
          {t('benchmark.learnMore')}
        </button>
      </div>

      <p className={`benchmark-vs-summary ${alpha >= 0 ? 'text-pos' : 'text-neg'}`}>{summary}</p>

      <div className="index-chart-frame">
        <svg className="sparkline" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('benchmark.vsTitle')}>
          <path d={pathFrom(indexRebased, min, span)} fill="none" stroke={INDEX_STROKE}
                strokeWidth="2" strokeDasharray="5 4" strokeLinejoin="round" strokeLinecap="round" />
          <path d={pathFrom(portfolioRebased, min, span)} fill="none" stroke={PORTFOLIO_STROKE}
                strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
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
