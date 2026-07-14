/**
 * Small "i" affordance with a hover/focus tooltip.
 * - `label`: plain-text tip (single string).
 * - `items`: structured tip — array of { term, detail } rendered as labeled rows.
 * `placement="top"` opens the tip upward (for hints near a clipping bottom edge).
 */
export default function InfoHint({ label, items, placement = 'bottom', art = null }) {
  const rows = Array.isArray(items) ? items.filter((it) => it && it.detail) : [];
  const hasRows = rows.length > 0;
  if (!label && !hasRows) return null;

  const ariaText = hasRows
    ? rows.map((it) => (it.term ? `${it.term}: ${it.detail}` : it.detail)).join('. ')
    : label;

  return (
    <span
      className={`info-hint info-hint--${placement}`}
      tabIndex={0}
      role="note"
      aria-label={ariaText}
    >
      <span aria-hidden="true">i</span>
      <span className="info-hint-tip" role="tooltip" aria-hidden="true">
        {art && <span className="info-hint-tip-art">{art}</span>}
        {hasRows ? (
          <span className="info-hint-tip-list">
            {rows.map((it, i) => (
              <span className="info-hint-tip-row" key={i}>
                {it.term && <span className="info-hint-tip-term">{it.term}</span>}
                <span className="info-hint-tip-detail">{it.detail}</span>
              </span>
            ))}
          </span>
        ) : (
          <span className="info-hint-tip-copy">{label}</span>
        )}
      </span>
    </span>
  );
}
