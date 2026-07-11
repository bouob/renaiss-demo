# TASK-004 — Port client shared libs (merchantCopilot + formatters)

Status: DONE

## Summary
Ported four pure client lib modules verbatim from `D:/Desktop/Dokipoki/client/src/lib/`
into `D:/Desktop/project-renaiss/client/src/lib/`. No logic changes — byte-for-byte
copies (diff confirmed identical). No secrets involved (all four are pure
formatter/classifier modules with no I/O, no env reads, no keys).

## Files created
- `D:/Desktop/project-renaiss/client/src/lib/merchantCopilot.js` — exports
  `classifyMerchantDecision`, `classifyMerchantDecisionDetail`, `MERCHANT_DECISIONS`,
  `LIQUIDITY_BANDS` (+ threshold consts). Contains all three decision branches
  (promote/hold/clear) and the thin-market (`thinMarketData === true` → hold)
  handling path.
- `D:/Desktop/project-renaiss/client/src/lib/localizedName.js` — exports
  `localizedCardName`, `localizedSetName`, `localizedSetLabel`.
- `D:/Desktop/project-renaiss/client/src/lib/priceDisplay.js` — exports
  `NO_PRICE_INFO`, `formatSignedCurrency`.
- `D:/Desktop/project-renaiss/client/src/lib/cardLabels.js` — exports
  `formatYearSetLabel`, `getCardYear`, `getCardSetName`.

## Verification evidence

Diff against Dokipoki source (all four report identical, no output before the
echo confirms):
```
$ diff .../Dokipoki/.../merchantCopilot.js .../project-renaiss/.../merchantCopilot.js && echo IDENTICAL
merchantCopilot: IDENTICAL
localizedName: IDENTICAL
priceDisplay: IDENTICAL
cardLabels: IDENTICAL
```

`node --check` from `client/` (package.json has `"type": "module"`, matches ESM
`export` syntax in these files):
```
$ cd D:/Desktop/project-renaiss/client && node --check src/lib/merchantCopilot.js && echo OK1
OK1
$ node --check src/lib/localizedName.js && echo OK2
OK2
$ node --check src/lib/priceDisplay.js && echo OK3
OK3
$ node --check src/lib/cardLabels.js && echo OK4
OK4
```

Grep confirming decision branches in merchantCopilot.js:
```
export const MERCHANT_DECISIONS = ['promote', 'hold', 'clear'];
... decision: 'hold' (multiple branches) ...
... decision: 'promote' ...
... decision: 'clear' ...
if (thinMarketData === true) return { decision: 'hold', ... }  // thin-market path
```

## Notes / deviations
- None. These four files had zero dependency on server-side/Firebase code in the
  source, so the copy required no import rewrites (pure functions, no I/O).
  Confirmed: `grep -n "^import"` across all four files returns no matches —
  nothing to resolve/rewrite, verbatim copy is safe.
- `WORKSPACE`/handoff-schema paths passed in the task prompt were literally the
  string `undefined` — no `sprint-plan.md` or schema file was found at that
  location, and no other progress files exist yet under
  `D:/Desktop/project-renaiss/sprint-progress/` to confirm a schema convention
  against. This file uses a plain status/summary/evidence/notes structure;
  adjust if the harness expects a different schema.
- Did not `git commit` / `git push` per instructions.

## Dependency status observed
- TASK-002 (client scaffold) appears complete: `client/package.json`,
  `vite.config.js`, `src/App.jsx`, `src/main.jsx`, `src/lib/httpClient.js`,
  `src/lib/hostRedirect.js` all present prior to this task starting.
