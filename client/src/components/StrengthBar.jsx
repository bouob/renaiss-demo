import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { computeStrength } from '../lib/priceStrength.js';

// --promote (#39ff14) / --clear (#ff4d6d): the same pos/neg tokens the movers
// list uses for the 30d-change and alpha figures, expressed as RGB so we can
// ramp their opacity per cell.
const POSITIVE_RGB = '57, 255, 20';
const NEGATIVE_RGB = '255, 77, 109';
const SEGMENTS_PER_SIDE = 5;

function formatMagnitude(pp) {
  return `${Math.abs(pp).toFixed(1)}%`;
}

// Cells nearest the center read faint ("light red / light green"); cells at the
// edge read solid ("full red / full green"), ramping across the 5 cells a side.
function cellOpacity(distanceFromCenter) {
  return 0.4 + 0.6 * ((distanceFromCenter - 1) / (SEGMENTS_PER_SIDE - 1));
}

/**
 * Signed market-relative strength meter for a Renaiss holding, drawn as ten
 * equal diverging cells (five red under-market on the left, five green
 * over-market on the right, an unlit grey rail at rest). Cells light outward
 * from the center toward the holding's 30-day alpha, so a marginal beat lights
 * one green cell and a saturated ±20pp mover fills all five on its side — no
 * visible number, since anyone who opts in wants the directional state, not a
 * softened grade. The exact alpha lives in the hover tooltip. Renders nothing
 * when alpha is missing.
 *
 * @param {{ alphaPct30d: number|null|undefined }} props - alpha as a fraction (0.106 = +10.6%).
 */
export default function StrengthBar({ alphaPct30d }) {
  const { t } = useTranslation();
  const [tip, setTip] = useState(null);
  const strength = computeStrength(alphaPct30d);
  if (!strength) return null;

  const { pp, norm, tone } = strength;
  // Whole cells lit, filling outward from the center. A real (non-neutral)
  // reading always lights at least one cell so a marginal beat still registers.
  const litCount = tone === 'neutral'
    ? 0
    : Math.max(1, Math.round(Math.abs(norm) * SEGMENTS_PER_SIDE));
  // Heading reads as plain language ("X% stronger/weaker than the market"), so
  // the sign becomes a word and the magnitude is unsigned; neutral has no figure.
  const headingKey =
    tone === 'positive' ? 'dashboard.strengthStronger'
      : tone === 'negative' ? 'dashboard.strengthWeaker'
        : 'dashboard.strengthEven';
  const headingText = t(headingKey, { alpha: formatMagnitude(pp) });
  const bodyText = t('dashboard.strengthBody');
  // Accessible name folds the visual heading + body into one sentence.
  const label = `${headingText}. ${bodyText}`;
  const headingClass =
    tone === 'positive' ? 'text-pos' : tone === 'negative' ? 'text-neg' : 'strength-tip-heading-even';

  // Indices 0-4 are the red side rendered left-to-right, 5-9 the green side.
  // distanceFromCenter (1 nearest the middle → 5 at the edge) drives both
  // whether a cell is lit and how solid its tone reads.
  const cells = [];
  for (let i = 0; i < SEGMENTS_PER_SIDE * 2; i += 1) {
    const isRight = i >= SEGMENTS_PER_SIDE;
    const distanceFromCenter = isRight ? i - SEGMENTS_PER_SIDE + 1 : SEGMENTS_PER_SIDE - i;
    const lit =
      (isRight && tone === 'positive' && distanceFromCenter <= litCount) ||
      (!isRight && tone === 'negative' && distanceFromCenter <= litCount);
    const rgb = isRight ? POSITIVE_RGB : NEGATIVE_RGB;
    cells.push(
      <span
        key={i}
        className="strength-cell"
        style={{ background: lit ? `rgba(${rgb}, ${cellOpacity(distanceFromCenter)})` : 'rgba(255, 255, 255, 0.06)' }}
        aria-hidden="true"
      />
    );
  }

  const show = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ x: r.left + r.width / 2, y: r.top });
  };
  const hide = () => setTip(null);

  return (
    <span
      role="img"
      aria-label={label}
      className="strength-bar"
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      {cells}
      {tip && createPortal(
        <div
          className="strength-tip"
          style={{ left: tip.x, top: tip.y - 10, transform: 'translate(-50%, -100%)' }}
        >
          <span className={`strength-tip-heading ${headingClass}`}>
            {headingText}
          </span>
          <span className="strength-tip-body">
            {bodyText}
          </span>
        </div>,
        document.body
      )}
    </span>
  );
}
