const { execSync } = require('child_process');
const url = 'http://localhost:3000';

function openBrowser() {
  const cmd =
    process.platform === 'darwin'
      ? `open "${url}"`
      : process.platform === 'win32'
        ? `start "" "${url}"`
        : `xdg-open "${url}"`;
  try {
    execSync(cmd, { stdio: 'inherit', shell: true });
    console.log('Браузер открыт:', url);
  } catch (e) {
    console.error('Не удалось открыть браузер:', e.message);
    console.log('Откройте вручную:', url);
  }
}

// Открываем сразу — wait-on уже дождался готовности сервера
openBrowser();
