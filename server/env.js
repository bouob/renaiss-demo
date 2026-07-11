// This module MUST be the first import in index.js.
// In ES modules, all static imports are hoisted and run before module body code,
// so dotenv.config() called from index.js's own body would run AFTER any other
// imported module has already read process.env at its own import time. Importing
// this file first guarantees env vars are set before that happens (same pattern
// as Dokipoki server/env.js).

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load root .env (RENAISS_INDEX_API_KEY/SECRET, BSC_RPC_URL, GCP_SERVICE_ACCOUNT_BASE64, ...)
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Load optional server-local .env overrides (never committed — see .gitignore)
dotenv.config({ path: path.resolve(__dirname, '.env'), override: false });
