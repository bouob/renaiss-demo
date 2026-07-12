export default function InfoHint({ label }) {
  if (!label) return null;
  return (
    <span className="info-hint" tabIndex={0} role="note" aria-label={label} data-tip={label}>
      <span aria-hidden="true">i</span>
    </span>
  );
}
