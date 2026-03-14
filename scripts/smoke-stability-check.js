const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function assertIncludes(contents, snippet, label) {
  if (!contents.includes(snippet)) {
    throw new Error(`Missing contract: ${label}`);
  }
}

async function fetchText(url) {
  const response = await fetch(url);
  const text = await response.text();
  return { response, text };
}

async function runRuntimeSmoke(baseUrl) {
  const trimmedBaseUrl = String(baseUrl || '').replace(/\/$/, '');
  if (!trimmedBaseUrl) {
    throw new Error('Runtime smoke requires SMOKE_RUNTIME_URL');
  }

  const health = await fetchText(`${trimmedBaseUrl}/api/health`);
  if (!health.response.ok) {
    throw new Error(`Runtime smoke failed: /api/health returned ${health.response.status}`);
  }
  const healthJson = JSON.parse(health.text);
  if (!healthJson || healthJson.ok !== true) {
    throw new Error('Runtime smoke failed: /api/health payload is invalid');
  }

  const root = await fetchText(`${trimmedBaseUrl}/`);
  if (!root.response.ok) {
    throw new Error(`Runtime smoke failed: / returned ${root.response.status}`);
  }
  if (!root.text.includes('<!DOCTYPE html>') && !root.text.includes('<html')) {
    throw new Error('Runtime smoke failed: root route did not return HTML');
  }
}

async function main() {
  const ecosystem = read('ecosystem.config.js');
  const nginx = read('deploy/nginx.conf');
  const mainTs = read('backend/src/main.ts');
  const payments = read('backend/src/payments/payments.service.ts');
  const appTsx = read('Frontend/src/App.tsx');
  const support = read('Frontend/src/components/SupportChat.tsx');
  const authSession = read('Frontend/src/authSession.ts');

  assertIncludes(ecosystem, "name: 'game-backend'", 'PM2 app name is game-backend');
  assertIncludes(ecosystem, "cwd: '/var/www/game'", 'PM2 cwd points to /var/www/game');
  assertIncludes(ecosystem, "PORT: 3000", 'PM2 uses backend port 3000');

  assertIncludes(nginx, 'legendgames.space', 'nginx uses production domain legendgames.space');
  assertIncludes(nginx, 'server 127.0.0.1:3000;', 'nginx upstream points to backend 3000');
  assertIncludes(nginx, 'location = /api/health', 'nginx proxies /api/health explicitly');

  const envPos = mainTs.indexOf("join(__dirname, '..', '.env')");
  const envProdPos = mainTs.indexOf("join(__dirname, '..', `.env.${process.env.NODE_ENV || 'development'}`)");
  if (envPos === -1 || envProdPos === -1 || envPos > envProdPos) {
    throw new Error('Missing contract: backend loads .env before env-specific file');
  }

  assertIncludes(payments, "/#/profile?section=finance-topup&payment=success", 'payments return URL uses HashRouter finance-topup success route');
  assertIncludes(payments, "/#/profile?section=finance-topup&payment=cancelled", 'payments cancel URL uses HashRouter finance-topup cancelled route');

  assertIncludes(appTsx, 'AUTH_SESSION_INVALID_EVENT', 'App listens for unified auth invalidation');
  assertIncludes(appTsx, "consumePendingReturnTo('/profile')", 'App restores intended route after login');
  assertIncludes(authSession, "AUTH_RETURN_TO_STORAGE_KEY = 'auth_return_to'", 'shared auth returnTo storage key exists');

  assertIncludes(support, "const returnTo = searchParams.get('returnTo');", 'SupportChat reads returnTo param');
  assertIncludes(support, "navigate('/profile?section=news');", 'SupportChat falls back to news section');

  if (process.env.SMOKE_RUNTIME_URL) {
    await runRuntimeSmoke(process.env.SMOKE_RUNTIME_URL);
  }

  console.log('smoke-stability-check: OK');
}

try {
  main().catch((error) => {
    console.error(`smoke-stability-check: FAIL\n${error.message}`);
    process.exit(1);
  });
} catch (error) {
  console.error(`smoke-stability-check: FAIL\n${error.message}`);
  process.exit(1);
}
