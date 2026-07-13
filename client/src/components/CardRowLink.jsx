import { useTranslation } from 'react-i18next';
import { resolveIndexUrl, openIndexPage } from '../lib/renaissIndexUrl.js';

/**
 * Clickable market row → Renaiss OS Index (Dokipoki-aligned).
 * Renders a static row when href is missing/invalid.
 */
export default function CardRowLink({
  href,
  name,
  meta,
  trailing,
  thumb,
  className = '',
}) {
  const { t } = useTranslation();
  const indexUrl = resolveIndexUrl(href);
  const content = (
    <>
      {thumb !== undefined && (
        thumb ? (
          <img src={thumb} alt="" loading="lazy" className="row-thumb" />
        ) : (
          <div className="thumb-fallback row-thumb">{t('common.card')}</div>
        )
      )}
      <div className="list-item-body">
        <div className="list-item-title-row">
          <strong className="list-item-name">{name ?? t('common.emDash')}</strong>
          {indexUrl && <span className="ext-hint" aria-hidden="true">↗</span>}
        </div>
        {meta && <div className="small">{meta}</div>}
      </div>
      {trailing != null && <div className="list-item-meta">{trailing}</div>}
    </>
  );

  if (indexUrl) {
    return (
      <a
        className={`list-item list-item-link ${className}`.trim()}
        href={indexUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => openIndexPage(href, e)}
      >
        {content}
      </a>
    );
  }

  return (
    <div className={`list-item list-item-static ${className}`.trim()} title={t('common.noIndexLink')}>
      {content}
    </div>
  );
}
