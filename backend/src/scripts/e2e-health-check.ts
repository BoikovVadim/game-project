import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';

type HttpJson = Record<string, unknown>;

async function waitForHealthy(url: string, attempts = 40): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Backend is still starting up.
    }
    await delay(1000);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function readJson(url: string): Promise<HttpJson> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return (await response.json()) as HttpJson;
}

async function main(): Promise<void> {
  const port = process.env.E2E_PORT || '3201';
  const baseUrl = `http://127.0.0.1:${port}`;
  const backendRoot = path.resolve(__dirname, '..', '..');

  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: backendRoot,
    env: {
      ...process.env,
      PORT: port,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });

  try {
    await waitForHealthy(`${baseUrl}/api/health`);

    const health = await readJson(`${baseUrl}/api/health`);
    if (health.ok !== true || typeof health.timestamp !== 'string') {
      throw new Error('Health payload is invalid');
    }

    const providers = await readJson(`${baseUrl}/payments/providers`);
    if (
      typeof providers.yookassa !== 'boolean' ||
      typeof providers.robokassa !== 'boolean'
    ) {
      throw new Error('Payment providers payload is invalid');
    }
  } finally {
    child.kill('SIGTERM');
    await Promise.race([
      once(child, 'exit'),
      delay(5000).then(() => {
        child.kill('SIGKILL');
      }),
    ]);
  }

  if (stderr.trim()) {
    process.stderr.write(stderr);
  }

  process.stdout.write('e2e-health-check: OK\n');
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.stack || error.message : String(error);
  process.stderr.write(`e2e-health-check: FAIL\n${message}\n`);
  process.exit(1);
});
