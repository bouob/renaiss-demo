# Inventory Login Gate — Design

**Date:** 2026-07-12
**Status:** Approved

## Goal

Require Firebase sign-in before a user can view the `/inventory` page. Signed-out
users see a sign-in prompt instead of the inventory UI.

## Decisions

- **Gate style:** Replace the page with a sign-in prompt card when signed out.
  Once signed in, the real `Inventory` page renders.
- **No-auth builds (Version A):** Fail open. When Firebase is not configured
  (`isFirebaseConfigured === false`) there is no way to sign in, so access is
  allowed as today. The gate only applies when auth is actually available.

## Components

### `client/src/components/RequireAuth.jsx` (new)

Thin wrapper deciding what to render for its children. Props:
`user`, `authReady`, `firebaseOk`, `onSignIn`, `authError`.

Decision order:

1. `firebaseOk === false` → render `children` (fail open).
2. `authReady === false` → render a lightweight loading placeholder (prevents a
   gate flash while `onAuthStateChanged` resolves).
3. `authReady && !user` → render the **sign-in gate card**: title + subtitle, a
   primary "Sign in with Google" button wired to `onSignIn`, and `authError`
   surfaced if a prior sign-in attempt failed. Uses existing `glass-card` /
   `empty` styles.
4. `user` present → render `children` (the real `Inventory`).

### `client/src/App.jsx` (modified)

Wrap the `/inventory` route element in `<RequireAuth>`, passing `user`,
`authReady`, `firebaseOk`, `onSignIn`, and `authError` down. `onSignIn` and
`authError` already exist in `App` (currently only passed to `Layout`).

### i18n (modified)

Add to `en.json`, `ja.json`, `zh-TW.json` under `inventory`:

- `gate.title`
- `gate.subtitle`
- `gate.signIn`

## Left Untouched

`Inventory.jsx` guest-mode code stays as-is — harmless and now unreachable via
the gate. The sign-out cleanup effect keeps working.

## Data Flow

`App` (auth state) → `RequireAuth` (gate decision) → `Inventory` (unchanged).

## Testing

No new automated tests required; a manual smoke check (signed-out shows gate,
sign-in reveals Inventory, Version A build still reaches Inventory) suffices.
