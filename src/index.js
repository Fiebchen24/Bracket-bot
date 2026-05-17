const config = require('./config');
require('./db/database');

const mode = (process.env.SERVICE_MODE || process.env.APP_MODE || 'all').toLowerCase();

async function startBot() {
  if (!config.token) throw new Error('Missing DISCORD_TOKEN');
  const client = require('./bot/client');
  await client.login(config.token);
}

function startDashboard() {
  const { startWeb } = require('./web/server');
  startWeb();
}

if (mode === 'bot') {
  startBot();
} else if (mode === 'web' || mode === 'dashboard') {
  startDashboard();
} else {
  // Local/dev mode: run both together. On Render use SERVICE_MODE=bot for Worker and SERVICE_MODE=web for Web Service.
  startBot();
  startDashboard();
}
