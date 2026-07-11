/**
 * Layout client/dist (Vite base=/merchant/) into hosting-public/merchant/**
 * so Firebase Hosting serves assets at /merchant/assets/* correctly.
 */
import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'client', 'dist');
const out = join(root, 'hosting-public');
const merchant = join(out, 'merchant');

if (!existsSync(dist)) {
  console.error('[prepare-hosting] client/dist missing — run client build first');
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(merchant, { recursive: true });
cpSync(dist, merchant, { recursive: true });

// Root bounce → /merchant/ (preview channel root is otherwise empty)
writeFileSync(
  join(out, 'index.html'),
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="refresh" content="0;url=/merchant/" />
    <link rel="canonical" href="/merchant/" />
    <title>Renaiss Merchant Copilot</title>
    <script>location.replace('/merchant/' + location.search + location.hash);</script>
  </head>
  <body>
    <p><a href="/merchant/">Continue to Merchant Copilot</a></p>
  </body>
</html>
`,
  'utf8',
);

console.log('[prepare-hosting] wrote hosting-public/merchant from client/dist');
