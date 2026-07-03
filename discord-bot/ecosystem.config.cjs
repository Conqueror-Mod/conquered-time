// pm2 process configuration for the Conquered Time beta bot.
//
//   pm2 start ecosystem.config.cjs      # start (after `npm run build`)
//   pm2 logs conquered-bot              # tail logs
//   pm2 restart conquered-bot           # restart (after a rebuild)
//   pm2 stop conquered-bot              # stop
//   pm2 delete conquered-bot            # remove from pm2
//
// Runs the COMPILED bot (dist/index.js), so build first. .env is loaded by
// absolute path in config.ts, so the working directory doesn't matter — but we
// set cwd anyway for clean relative logs.
const path = require('path');

module.exports = {
  apps: [
    {
      name: 'conquered-bot',
      cwd: __dirname,
      script: path.join(__dirname, 'dist', 'index.js'),
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000, // wait 3s before restarting after a crash
      time: true,          // prefix log lines with timestamps
      env: { NODE_ENV: 'production' },
    },
  ],
};
