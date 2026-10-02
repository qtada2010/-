const { REST, Routes } = require('discord.js');
const additionalCommands = require('./slashCommands').commandData;

// يستقبل client (بوت الديسكورد) و sendLogError (من utils/ticketHelpers) من index.js
module.exports = function registerReadyEvent(client, sendLogError) {

client.once('ready', async () => {
  console.log(`🤖 تم تسجيل الدخول بأسـم: ${client.user.tag}`);

  // 📖 أمر help صار ضمن additionalCommands (slashCommands.js) بعد توحيده،
  // فلا يُسجَّل هنا مرة ثانية حتى لا يرفض ديسكورد الاسم المكرر.
  const commands = [...additionalCommands];

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('✅ تم تسجيل أوامر السلاش (/) بنجاح!');
  } catch (e) {
    sendLogError('خطأ أثناء تسجيل الأوامر:', e);
  }
});

};
