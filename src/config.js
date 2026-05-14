require('dotenv').config();
module.exports = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
  sessionSecret: process.env.SESSION_SECRET || 'dev-secret',
  baseUrl: process.env.BASE_URL || 'http://localhost:3000',
  port: Number(process.env.PORT || 3000),
  dbPath: process.env.DB_PATH || './data/bracketbot.sqlite'
};
