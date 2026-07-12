import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import IndexTile from './IndexTile.jsx';
import BenchmarkVsChart from './BenchmarkVsChart.jsx';
import { fetchPortfolioSeries } from '../lib/portfolioSeriesApi.js';
import { readLastWallet } from '../lib/lastWallet.js';

const MIN_COVERED = 2;

export default function BenchmarkPanel({ index, user, getToken, dateLocale }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState('index');
  const [series, setSeries] = useState(null); // resolved payload
  const [status, setStatus] = useState('idle'); // idle | loading | ready | nowallet

  // Reset when the signed-in user changes (avoid showing a prior account's data).
  useEffect(() => {
    setSeries(null);
    setStatus('idle');
    if (!user) setTab('index');
  }, [user]);

  const loadSeries = useCallback(async () => {
    setStatus('loading');
    const wallet = readLastWallet();
    if (!wallet) { setStatus('nowallet'); return; }
    try {
      const token = await getToken();
      if (!token) { setStatus('nowallet'); return; }
      const payload = await fetchPortfolioSeries({ authToken: token, wallet });
      setSeries(payload ?? null);
      setStatus('ready');
    } catch {
      setSeries(null);
      setStatus('ready'); // fail-open: render empty/no-benchmark state, not an error
    }
  }, [getToken]);

  // Lazily fetch whenever the Vs tab is active and idle: covers first
  // activation and an account switch that resets status while on this tab.
  useEffect(() => {
    if (user && tab === 'vs' && status === 'idle') loadSeries();
  }, [user, tab, status, loadSeries]);

  // Guests: no tab bar, Index view only (zero visual change, no auth fetch path).
  if (!user) {
    return <IndexTile index={index} dateLocale={dateLocale} />;
  }

  return (
    <div className="benchmark-panel">
      <div className="benchmark-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'index'}
                className={`benchmark-tab ${tab === 'index' ? 'active' : ''}`}
                onClick={() => setTab('index')}>
          {t('benchmark.tabIndex')}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'vs'}
                className={`benchmark-tab ${tab === 'vs' ? 'active' : ''}`}
                onClick={() => setTab('vs')}>
          {t('benchmark.tabVs')}
        </button>
      </div>

      {tab === 'index' && <IndexTile index={index} dateLocale={dateLocale} />}

      {tab === 'vs' && (
        <div className="benchmark-vs-pane">
          {status === 'loading' && <div className="empty">{t('benchmark.loading')}</div>}
          {status === 'nowallet' && <div className="empty">{t('benchmark.vsNoWallet')}</div>}
          {status === 'ready' && (() => {
            if (!series || !series.index) {
              return <div className="empty">{t('benchmark.vsNoBenchmark')}</div>;
            }
            const included = series.coverage?.included ?? 0;
            if (included < MIN_COVERED || !series.portfolio?.length) {
              return (
                <div className="empty">
                  {t('benchmark.vsEmpty', {
                    included,
                    total: series.coverage?.total ?? 0,
                  })}
                </div>
              );
            }
            return (
              <BenchmarkVsChart
                portfolio={series.portfolio}
                index={series.index}
                coverage={series.coverage}
              />
            );
          })()}
        </div>
      )}
    </div>
  );
}
