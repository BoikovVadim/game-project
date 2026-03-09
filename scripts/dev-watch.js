#!/usr/bin/env node
/**
 * Запуск dev с автообновлением: следит за Frontend/src,
 * при изменении пересобирает и записывает timestamp — страница сама перезагружается.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LAST_REBUILD = path.join(ROOT, '.last-rebuild');

function writeTimestamp() {
  fs.writeFileSync(LAST_REBUILD, String(Date.now()), 'utf8');
}

function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, stdio: 'inherit', shell: true });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Exit ${code}`))));
  });
}

async function buildFrontend() {
  console.log('\n[watch] Изменения обнаружены, пересборка...');
  await run('npm', ['run', 'build'], path.join(ROOT, 'Frontend'), { CI: 'true' });
  writeTimestamp();
  console.log('[watch] Готово, страница обновится автоматически.\n');
}

let buildTimeout = null;
function scheduleBuild() {
  if (buildTimeout) clearTimeout(buildTimeout);
  buildTimeout = setTimeout(() => {
    buildTimeout = null;
    buildFrontend().catch((e) => console.error('[watch] Ошибка:', e.message));
  }, 300);
}

function startWatcher() {
  const srcDir = path.join(ROOT, 'Frontend', 'src');
  const publicDir = path.join(ROOT, 'Frontend', 'public');
  let useChokidar = false;
  try {
    const chokidar = require('chokidar');
    console.log('[watch] Слежу за Frontend (src, public)');
    const watcher = chokidar.watch([srcDir, publicDir], { ignored: /node_modules/ });
    watcher.on('change', () => scheduleBuild());
    watcher.on('error', (e) => console.warn('[watch] Ошибка:', e.message));
    useChokidar = true;
  } catch (_) {}
  if (!useChokidar) {
    console.log('[watch] chokidar не найден, использую fs.watch');
    try {
      fs.watch(srcDir, { recursive: true }, (event, filename) => {
        if (filename && !filename.includes('node_modules')) scheduleBuild();
      });
    } catch (e) {
      console.warn('[watch] Ошибка:', e.message);
    }
  }
}

// Записываем начальный timestamp
writeTimestamp();
startWatcher();
