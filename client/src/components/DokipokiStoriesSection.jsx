import { useEffect, useRef, useState } from 'react';
import { Newspaper } from 'lucide-react';
import dokipokiLogo from '../../Assets/Dokipoki.png';

const AUTO_MS = 5000;

const CATEGORY_COLORS = {
  price_movement: ['#FFD60A', '💰'],
  set_release: ['#4ADE80', '📦'],
  market_trend: ['#4CC9F0', '📈'],
  community: ['#A78BFA', '🗣️'],
  tournament: ['#FB923C', '🏆'],
};

const SENTIMENT_COLORS = {
  bullish: 'story-sentiment story-sentiment-positive',
  bearish: 'story-sentiment story-sentiment-negative',
  neutral: 'story-sentiment',
};

function categoryLabel(category) {
  return String(category || 'market trend').replace(/_/g, ' ');
}

function StoryCard({ card }) {
  const signal = card?.signal || {};
  const featured = signal.matchedCards?.[0];
  const [categoryColor, categoryIcon] = CATEGORY_COLORS[signal.category] || CATEGORY_COLORS.market_trend;
  const sentiment = String(signal.sentiment || 'neutral').toLowerCase();
  const [imageSrc, setImageSrc] = useState(featured?.image || dokipokiLogo);
  const [isFallbackImage, setIsFallbackImage] = useState(!featured?.image);

  return (
    <article className="dokipoki-story-card">
      <div className="dokipoki-story-meta">
        <span className="dokipoki-story-category" style={{ color: categoryColor }}>
          {categoryIcon} {categoryLabel(signal.category)}
        </span>
        <span className={SENTIMENT_COLORS[sentiment] || SENTIMENT_COLORS.neutral}>{sentiment}</span>
      </div>
      <div className="dokipoki-story-content">
        <img
          className={isFallbackImage ? 'dokipoki-story-image dokipoki-story-image-fallback' : 'dokipoki-story-image'}
          src={imageSrc}
          alt=""
          loading="lazy"
          onError={() => {
            setImageSrc(dokipokiLogo);
            setIsFallbackImage(true);
          }}
        />
        <div>
          {signal.title && <h3>{signal.title}</h3>}
          {signal.summary && <p>{signal.summary}</p>}
        </div>
      </div>
      {card.generatedAt && (
        <time dateTime={card.generatedAt}>
          {new Date(card.generatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
        </time>
      )}
    </article>
  );
}

export default function DokipokiStoriesSection({ stories, loading }) {
  const [page, setPage] = useState(1);
  const [paused, setPaused] = useState(false);
  const reducedMotion = useRef(false);
  const totalPages = Math.max(1, stories.length);
  const safePage = Math.min(page, totalPages);
  const activeStory = stories[safePage - 1];

  useEffect(() => {
    reducedMotion.current = typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  useEffect(() => {
    setPage(1);
  }, [stories.length]);

  useEffect(() => {
    if (totalPages <= 1 || paused || reducedMotion.current) return undefined;
    const id = window.setInterval(() => {
      setPage((current) => (current >= totalPages ? 1 : current + 1));
    }, AUTO_MS);
    return () => window.clearInterval(id);
  }, [paused, totalPages]);

  return (
    <section
      className="glass-card dokipoki-stories-section"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false);
      }}
    >
      <div className="index-tile-head dokipoki-stories-header">
        <div>
          <p className="label" style={{ margin: 0 }}>
            <Newspaper size={14} aria-hidden="true" /> News
          </p>
          <p className="small">Fresh market context keeps you ahead.</p>
        </div>
      </div>
      {loading ? (
        <div className="dokipoki-stories-loading" aria-label="Loading daily stories">
          <div />
        </div>
      ) : stories.length ? (
        <>
          <div className="dokipoki-stories-carousel" key={activeStory.id}>
            <StoryCard card={activeStory} />
          </div>
          {totalPages > 1 && (
            <div className="top-board-controls">
              <div className="top-board-dots" aria-label="News pages">
                {Array.from({ length: totalPages }, (_, index) => {
                  const dotPage = index + 1;
                  const isActive = dotPage === safePage;
                  return (
                    <button
                      key={activeStory.id + dotPage}
                      type="button"
                      className={`top-board-dot${isActive ? ' active' : ''}`}
                      onClick={() => setPage(dotPage)}
                      onMouseEnter={() => setPaused(true)}
                      aria-label={`News ${dotPage}`}
                      aria-current={isActive ? 'page' : undefined}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="empty dokipoki-stories-empty">Daily stories are unavailable right now.</p>
      )}
    </section>
  );
}
