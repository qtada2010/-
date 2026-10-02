// حالة مشتركة بين الملفات (بديل عن المتغير العام ownerLogChannelId في الملف الأصلي)
// يستخدم ليتمكن أمر logowner (messageCreate) وأمر sendLogError (utils) من مشاركة نفس القيمة
const state = {
  ownerLogChannelId: null
};

module.exports = state;
