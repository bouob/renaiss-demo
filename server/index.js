/**
 * Firebase Functions entry (firebase deploy --only functions:merchantApi)
 * + local Express listen when IS_LOCAL_DEV=true.
 *
 * package.json "main": "index.js" for Firebase packaging.
 * GCF/gcloud path uses function.js instead (see CI stage step).
 */
import './env.js'; // MUST be first
import { onRequest } from 'firebase-functions/v2/https';
import { app } from './app.js';

const PORT = process.env.PORT || 3101;
const HOST = process.env.HOST || '0.0.0.0';

export const merchantApi = onRequest(
  {
    region: 'asia-east1',
    maxInstances: 1,
    timeoutSeconds: 60,
    memory: '512MiB',
  },
  app,
);

function startLocalServer(port, preferredHost) {
  const fallbackHost = '127.0.0.1';

  const listenOnHost = (host, allowFallback) => {
    const server = app.listen(port, host, () => {
      console.log(`Renaiss Merchant server running locally on http://${host}:${port}`);
    });

    server.on('error', (err) => {
      if (allowFallback && host !== fallbackHost && err.code === 'EPERM') {
        console.warn(`[server] Failed to bind ${host}:${port} (${err.code}). Retrying on ${fallbackHost}:${port}.`);
        return listenOnHost(fallbackHost, false);
      }

      console.error('[server] Local startup failed:', {
        message: err.message,
        code: err.code,
        address: err.address,
        port: err.port,
        host,
      });
      process.exit(1);
    });
  };

  listenOnHost(preferredHost, true);
}

if (process.env.IS_LOCAL_DEV === 'true') {
  startLocalServer(PORT, HOST);
}

export default app;
