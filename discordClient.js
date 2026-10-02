const { Client, GatewayIntentBits } = require('discord.js');

// ==========================================
// 2. إنشاء عميل ديسكورد (Discord Client)
// ==========================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates
  ]
});

const PREFIX = '!';
const ADMIN_PREFIX = '$';

module.exports = { client, PREFIX, ADMIN_PREFIX };
