const config = require('./config');
require('./db/database');
const client = require('./bot/client');
const { startWeb } = require('./web/server');
if (!config.token) throw new Error('Missing DISCORD_TOKEN');
client.login(config.token);
startWeb();
