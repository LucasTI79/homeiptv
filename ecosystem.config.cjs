module.exports = {
  apps: [
    {
      name: 'homeiptv-backend',
      script: './backend/dist/src/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      // PM2 is the persistent-process path (vs `npm run dev`), so its default
      // env is production -- this is what `npm run pm2:start` (no --env flag)
      // actually launches with. Session cookies only get the `secure` flag
      // when NODE_ENV === 'production' (backend/src/index.ts), so a stray
      // 'development' default here would silently ship insecure cookies.
      env: {
        NODE_ENV: 'production',
      },
      env_production: {
        NODE_ENV: 'production',
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './data/logs/pm2-error.log',
      out_file: './data/logs/pm2-out.log',
    },
  ],
};
