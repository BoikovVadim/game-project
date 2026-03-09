module.exports = {
  apps: [
    {
      name: 'legendgames',
      script: 'backend/dist/main.js',
      cwd: '/home/legend/app',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        TZ: 'Europe/Moscow',
      },
      instances: 1,
      autorestart: true,
      max_memory_restart: '512M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: '/home/legend/logs/error.log',
      out_file: '/home/legend/logs/out.log',
      merge_logs: true,
    },
  ],
};
