/**
 * renaissCertAdjacency.js — pure cert parsing + adjacent-cert math for the P5
 * "adjacent cert suggestions" feature (card detail page: for a held Renaiss
 * graded cert, suggest the ±1 neighbor certs — consecutive serials are often
 * same-batch/same-set submissions and can carry outsized collector value).
 *
 * Phase-0 finding (real cert samples): every tracked grader's cert is a
 * fixed-format "prefix + pure-digit serial", no dash — PSA (8 digits, e.g.
 * PSA41932666), CGC (10 digits, e.g. CGC6106213036), BGS (10 digits, MAY
 * carry leading zeros, e.g. BGS0017724927). The leading-zero case is why
 * ±1 math cannot use plain Number() round-tripping: `0017724927 - 1` must
 * stay a 10-digit string ("0017724926"), not collapse to "17724926" — a
 * naive numeric round-trip silently drops the padding and produces a cert
 * that does not exist upstream. adjacentCerts() rebuilds the neighbor with
 * `serialStr.length` as the padStart width, so the original digit count
 * (whatever it happened to be) is always preserved.
 *
 * Grader support is a small allowlist keyed by prefix (not a numeric range
 * table) so a future 4th grading company is a one-line addition — the ±1
 * math itself never needs to change.
 *
 * Pure module: no I/O, no env reads — directly unit-testable
 * (server/tests/renaissCertAdjacency.test.js).
 */

// Allowlisted grader prefixes. Kept as a Set (not baked into the regex
// alternation as a magic string) so `parseCert`'s "is this a known grader"
// check and any future grader-specific behavior share one source of truth.
const KNOWN_GRADERS = new Set(['PSA', 'CGC', 'BGS']);

// prefix (2-4 uppercase letters) + 1-20 digit serial, no dash — same shape
// family as renaissOsIndex.js's CERT_SHAPE, but grader-whitelisted here
// (renaissOsIndex.js's CERT_SHAPE is the broader injection guard on the
// upstream call itself; this module only needs to recognize the graders it
// actually knows how to compute neighbors for).
const CERT_PATTERN = /^([A-Za-z]{2,4})(\d{1,20})$/;

/**
 * Parses a graded cert string into its grader prefix and serial digit string.
 * The serial is kept as a *string* (not coerced to Number) so leading zeros
 * (BGS) survive round-tripping — callers that need the numeric value convert
 * it themselves and re-pad against `serialStr.length`.
 *
 * @param {string} cert
 * @returns {{ grader: string, serialStr: string }|null} null for anything
 *   that isn't a recognized-grader "prefix + digits" cert (wrong shape,
 *   unknown grader prefix, non-string input).
 */
export function parseCert(cert) {
  if (typeof cert !== 'string') return null;
  const match = cert.match(CERT_PATTERN);
  if (!match) return null;
  const [, rawGrader, serialStr] = match;
  const grader = rawGrader.toUpperCase();
  if (!KNOWN_GRADERS.has(grader)) return null;
  return { grader, serialStr };
}

/**
 * Computes the ±span neighbor cert strings around `cert`, preserving the
 * original serial's digit width (leading zeros included) via padStart.
 * Neighbors are skipped (not zero-padded into a wrong-length cert) when the
 * ±delta arithmetic would change the digit count — going negative, or
 * overflowing past the original width (e.g. 99999999 + 1 would need a 9th
 * digit) — since either case can no longer be represented as "the same
 * grader's N-digit serial format" and guessing would risk querying an
 * unrelated real cert.
 *
 * @param {string} cert
 * @param {number} [span=1] - how many serials out on each side (span=1 →
 *   [-1, +1]).
 * @returns {Array<{ delta: number, cert: string }>} ascending by delta;
 *   empty array for an unparseable cert or a non-positive/non-finite span.
 */
export function adjacentCerts(cert, span = 1) {
  const parsed = parseCert(cert);
  if (!parsed) return [];
  if (!Number.isFinite(span) || span < 1) return [];

  const { grader, serialStr } = parsed;
  const width = serialStr.length;
  const serialNum = Number(serialStr);
  // CERT_PATTERN admits up to 20 digits, which overshoots MAX_SAFE_INTEGER.
  // Such a value is still finite, so isFinite alone would let `serialNum + 1`
  // silently round to a number that is not the neighbor — and we would query a
  // real but unrelated cert. Real graders top out at 10 digits; refuse the rest.
  if (!Number.isSafeInteger(serialNum)) return [];

  const results = [];
  const truncatedSpan = Math.trunc(span);
  for (let delta = -truncatedSpan; delta <= truncatedSpan; delta += 1) {
    if (delta === 0) continue;
    const neighborNum = serialNum + delta;
    if (neighborNum < 0) continue;
    const neighborStr = String(neighborNum).padStart(width, '0');
    if (neighborStr.length !== width) continue; // overflowed the original digit width — do not guess
    results.push({ delta, cert: `${grader}${neighborStr}` });
  }
  return results;
}
