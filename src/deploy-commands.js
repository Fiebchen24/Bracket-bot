const { REST, Routes } = require('discord.js');
const config = require('./config');
const commands = require('./commands');
if (!config.token || !config.clientId) throw new Error('Missing DISCORD_TOKEN or CLIENT_ID');
const rest = new REST({ version: '10' }).setToken(config.token);
(async () => {
  console.log('Deploying global slash commands...');
  await rest.put(Routes.applicationCommands(config.clientId), { body: commands });
  console.log('Slash commands deployed.');
})();
