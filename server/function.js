/**
 * Google Cloud Functions (gen2) / Functions Framework entry.
 *
 * gcloud functions deploy … --entry-point=merchantApi
 * Buildpacks historically also look for function.js as the source file name —
 * keep this filename so Cloud Build does not fail with "function.js does not exist".
 *
 * package.json "main" is rewritten to this file in CI when staging for gcloud.
 */
import './env.js';
import { http } from '@google-cloud/functions-framework';
import { app } from './app.js';

// Named entry must match --entry-point / GOOGLE_FUNCTION_TARGET
http('merchantApi', app);
