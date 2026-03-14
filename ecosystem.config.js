module.exports = {
  apps: [
    {
      name: 'game-backend',
      script: 'backend/dist/main.js',
      cwd: '/var/www/game',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        TZ: 'Europe/Moscow',
      },
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
