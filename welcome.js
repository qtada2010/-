const { EmbedBuilder } = require('discord.js');
const { safeHexColor } = require('./webSafety');

// ==========================================================================
// 🟢 لوحة رسالة الترحيب (welcome.js) — ملف مستقل بالكامل، بنفس فكرة لوحة
// probot.io لرسائل الترحيب: تفعيل/تعطيل، اختيار الروم، نص/إيمبد قابل للتخصيص
// بمتغيرات ({user} / {username} / {server} / {membercount})، لون، وصورة.
// لا يلمس أي جدول أو ملف قديم إطلاقاً: ينشئ جدوله الخاص هنا فقط، ويضيف
// صفحة جديدة على نفس سيرفر الداشبورد (app) الممرر له من index.js فقط.
// ==========================================================================
module.exports = function createWelcomePanel(client, pool, app) {

  // ------------------------------------------------------------------------
  // 1. إنشاء جدول إعدادات الترحيب الخاص به فقط (IF NOT EXISTS)
  // ------------------------------------------------------------------------
  async function initWelcomeTable() {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS welcome_settings (
          key VARCHAR(50) PRIMARY KEY,
          enabled BOOLEAN DEFAULT false,
          channel_id VARCHAR(100) DEFAULT '',
          message_type VARCHAR(20) DEFAULT 'embed',
          title TEXT DEFAULT 'أهلاً بك في السيرفر! 👋',
          content TEXT DEFAULT 'أهلاً وسهلاً {user} بك في **{server}**!\nأنت العضو رقم **{membercount}** 🎉',
          color VARCHAR(20) DEFAULT '#0284c7',
          image_url TEXT DEFAULT '',
          thumbnail_enabled BOOLEAN DEFAULT true
        );
      `);

      // صف الإعدادات الافتراضي إن لم يكن موجوداً
      await pool.query(`
        INSERT INTO welcome_settings (key) VALUES ('main_welcome')
        ON CONFLICT (key) DO NOTHING;
      `);

      console.log('👋 تم تجهيز جدول إعدادات لوحة الترحيب بنجاح!');
    } catch (err) {
      console.error('❌ خطأ أثناء إنشاء جدول إعدادات الترحيب:', err);
    }
  }
  initWelcomeTable();

  // ------------------------------------------------------------------------
  // 2. دوال مساعدة عامة
  // ------------------------------------------------------------------------
  async function getSettings() {
    const res = await pool.query('SELECT * FROM welcome_settings WHERE key = $1', ['main_welcome']);
    return res.rows[0] || {
      enabled: false, channel_id: '', message_type: 'embed',
      title: 'أهلاً بك في السيرفر! 👋', content: 'أهلاً وسهلاً {user} بك في **{server}**!\nأنت العضو رقم **{membercount}** 🎉',
      color: '#0284c7', image_url: '', thumbnail_enabled: true
    };
  }

  // استبدال المتغيرات ({user} / {username} / {server} / {membercount}) داخل أي نص
  function applyPlaceholders(text, member) {
    return (text || '')
      .replaceAll('{user}', `<@${member.id}>`)
      .replaceAll('{username}', member.user ? member.user.username : member.username || '')
      .replaceAll('{server}', member.guild.name)
      .replaceAll('{membercount}', member.guild.memberCount);
  }

  // بناء رسالة الترحيب (نص أو إيمبد) لأي عضو مُعطى، حسب الإعدادات المحفوظة
  function buildWelcomeMessage(settings, member) {
    const replacedTitle = applyPlaceholders(settings.title, member);
    const replacedContent = applyPlaceholders(settings.content, member);

    if (settings.message_type === 'text') {
      return { content: `${replacedTitle}\n${replacedContent}` };
    }

    const embed = new EmbedBuilder()
      .setTitle(replacedTitle)
      .setDescription(replacedContent)
      // 🛡️ [إصلاح] لون محفوظ بصيغة تالفة كان يرمي خطأ داخل guildMemberAdd،
      // فلا تُرسل رسالة الترحيب لأي عضو جديد إطلاقاً (فشل صامت يصعب اكتشافه).
      .setColor(safeHexColor(settings.color))
      .setFooter({ text: 'حقوق البوت محفوظة لـ قتادة ©️ 2026' })
      .setTimestamp();

    if (settings.thumbnail_enabled) {
      const avatarUrl = member.user ? member.user.displayAvatarURL({ dynamic: true }) : member.displayAvatarURL({ dynamic: true });
      embed.setThumbnail(avatarUrl);
    }
    // 🛡️ [إصلاح] رابط صورة غير صالح كان يمنع رسالة الترحيب كلياً؛
    // الآن تُرسل الرسالة بدون الصورة بدل ألا تُرسل أبداً.
    if (settings.image_url) {
      try {
        embed.setImage(settings.image_url);
      } catch (imageError) {
        console.warn('⚠️ تم تجاهل رابط صورة ترحيب غير صالح:', imageError.message);
      }
    }

    return { embeds: [embed] };
  }

  // ------------------------------------------------------------------------
  // 3. حدث انضمام عضو جديد للسيرفر — إرسال رسالة الترحيب إن كانت مُفعّلة
  // ------------------------------------------------------------------------
  client.on('guildMemberAdd', async (member) => {
    try {
      const settings = await getSettings();
      if (!settings.enabled || !settings.channel_id) return;

      const channel = member.guild.channels.cache.get(settings.channel_id);
      if (!channel) return;

      await channel.send(buildWelcomeMessage(settings, member)).catch(err => console.error('❌ خطأ أثناء إرسال رسالة الترحيب:', err));
    } catch (err) {
      console.error('❌ خطأ أثناء معالجة رسالة الترحيب عند انضمام عضو:', err);
    }
  });

  // ------------------------------------------------------------------------
  // 4. صفحة الموقع (Dashboard) الخاصة بلوحة الترحيب — على نفس app الموجود
  // لا تلمس أي روت قديم بـ dashboard.js، فقط تضيف روتات جديدة بمسارات جديدة.
  // ------------------------------------------------------------------------
  if (app) {
    const dashboardAuth = require('./dashboardAuth');
    const escapeHtml = require('./htmlEscape');

    function requireAuthWelcome(req, res, next) {
      if (dashboardAuth.isAuthed(req)) return next();
      res.redirect('/login');
    }

    const pageWrapper = (title, body) => `
      <!DOCTYPE html>
      <html lang="ar" dir="rtl">
      <head>
        <meta charset="UTF-8">
        <title>${title}</title>
        <style>
          body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; margin:0; padding:0; }
          nav { background: #1e293b; padding: 15px 30px; display: flex; justify-content: space-between; align-items:center; border-bottom: 1px solid #334155; }
          nav .links a { color: #38bdf8; text-decoration: none; font-weight: bold; margin-left: 20px; }
          .container { max-width: 850px; margin: 40px auto; background: #1e293b; padding: 30px; border-radius: 12px; border: 1px solid #334155; }
          h1, h2 { color: #38bdf8; }
          label { display: block; margin-top: 15px; font-weight: bold; color:#cbd5e1; }
          input, select, textarea { width: 100%; padding: 10px; margin-top: 5px; border-radius: 6px; border: 1px solid #334155; background: #0f172a; color: #fff; box-sizing: border-box; font-family: inherit; }
          textarea { resize: vertical; }
          button { margin-top: 25px; width: 100%; padding: 12px; background: #0284c7; color: white; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; }
          .checkbox-row { display:flex; align-items:center; gap:10px; margin-top:15px; }
          .checkbox-row input { width:auto; margin:0; }
          .checkbox-row label { margin:0; }
          .hint-box { background:#0f172a; border:1px solid #334155; border-radius:8px; padding:14px 16px; margin-top:10px; color:#94a3b8; font-size:13px; line-height:1.9; }
          .hint-box code { background:#1e293b; color:#38bdf8; padding:2px 6px; border-radius:4px; }
          .test-btn { background:#334155; }
          .page-footer { text-align:center; margin-top:30px; padding-top:18px; border-top:1px solid #334155; color:#64748b; font-size:13px; }
        </style>
      </head>
      <body>
        <nav>
          <div class="links">
            <a href="/dashboard">الرئيسية 🏠</a>
            <a href="/panel">التذاكر 🎫</a>
            <a href="/commands">الأوامر ⚙️</a>
            <a href="/xp-settings">الإكسبي ⭐</a>
            <a href="/auto-roles">الرتب التلقائية 🎭</a>
            <a href="/welcome-settings">لوحة الترحيب 👋</a>
          </div>
          <a href="/logout" style="color:#ef4444; font-weight:bold; text-decoration:none;">تسجيل الخروج 🚪</a>
        </nav>
        <div class="container">
          ${body}
          <div class="page-footer">🄫 حقوق البوت محفوظة لـ قتادة ©️ 2026</div>
        </div>
      </body>
      </html>
    `;

    // صفحة لوحة الترحيب
    app.get('/welcome-settings', requireAuthWelcome, async (req, res) => {
      const s = await getSettings();
      const saved = req.query.saved === '1';
      const tested = req.query.tested === '1';
      const testError = req.query.testError;

      res.send(pageWrapper('لوحة الترحيب', `
        <h1>👋 لوحة رسالة الترحيب</h1>
        <p style="color:#94a3b8;">اضبط رسالة الترحيب التي تُرسل تلقائياً عند دخول أي عضو جديد للسيرفر.</p>

        ${saved ? '<div class="hint-box" style="border-color:#10b981; color:#10b981;">✅ تم حفظ إعدادات لوحة الترحيب بنجاح!</div>' : ''}
        ${tested ? '<div class="hint-box" style="border-color:#10b981; color:#10b981;">✅ تم إرسال رسالة تجريبية للروم بنجاح!</div>' : ''}
        ${testError ? `<div class="hint-box" style="border-color:#ef4444; color:#ef4444;">❌ تعذر إرسال الرسالة التجريبية: ${escapeHtml(testError)}</div>` : ''}

        <form action="/save-welcome-settings" method="POST">
          <div class="checkbox-row">
            <input type="checkbox" name="enabled" id="enabled" ${s.enabled ? 'checked' : ''}>
            <label for="enabled" style="margin-top:0;">تفعيل رسالة الترحيب التلقائية</label>
          </div>

          <label>آيدي روم الترحيب:</label>
          <input type="text" name="channelId" value="${escapeHtml(s.channel_id || '')}" placeholder="ضع هنا آيدي الروم" required>

          <label>نوع الرسالة:</label>
          <select name="messageType">
            <option value="embed" ${s.message_type === 'embed' ? 'selected' : ''}>إيمبد منسّق 🖼️</option>
            <option value="text" ${s.message_type === 'text' ? 'selected' : ''}>نص عادي 📝</option>
          </select>

          <label>عنوان الرسالة:</label>
          <input type="text" name="title" value="${escapeHtml(s.title || '')}" required>

          <label>محتوى الرسالة:</label>
          <textarea name="content" rows="4" required>${escapeHtml(s.content || '')}</textarea>
          <div class="hint-box">
            المتغيرات المتاحة داخل العنوان والمحتوى:<br>
            <code>{user}</code> منشن العضو الجديد &nbsp; | &nbsp;
            <code>{username}</code> اسم العضو &nbsp; | &nbsp;
            <code>{server}</code> اسم السيرفر &nbsp; | &nbsp;
            <code>{membercount}</code> عدد الأعضاء الحالي
          </div>

          <label>لون الإيمبد:</label>
          <input type="color" name="color" value="${escapeHtml(s.color || '#0284c7')}" style="height:40px;">

          <label>رابط صورة الإيمبد (اختياري):</label>
          <input type="url" name="imageUrl" value="${escapeHtml(s.image_url || '')}" placeholder="https://i.imgur.com/example.png">

          <div class="checkbox-row">
            <input type="checkbox" name="thumbnailEnabled" id="thumbnailEnabled" ${s.thumbnail_enabled ? 'checked' : ''}>
            <label for="thumbnailEnabled" style="margin-top:0;">عرض الصورة الشخصية للعضو داخل الإيمبد</label>
          </div>

          <button type="submit">حفظ إعدادات الترحيب 💾</button>
        </form>

        <form action="/test-welcome-message" method="POST">
          <button type="submit" class="test-btn">🧪 إرسال رسالة تجريبية للروم المحفوظ</button>
        </form>
      `));
    });

    app.post('/save-welcome-settings', requireAuthWelcome, async (req, res) => {
      const d = req.body || {};

      await pool.query(`
        UPDATE welcome_settings SET
          enabled = $1, channel_id = $2, message_type = $3, title = $4,
          content = $5, color = $6, image_url = $7, thumbnail_enabled = $8
        WHERE key = 'main_welcome';
      `, [
        d.enabled === 'on',
        (d.channelId || '').trim(),
        d.messageType === 'text' ? 'text' : 'embed',
        (d.title || '').trim(),
        d.content || '',
        // 🛡️ [إصلاح] منع حفظ لون غير صالح من الأساس
        safeHexColor(d.color),
        (d.imageUrl || '').trim(),
        d.thumbnailEnabled === 'on'
      ]);

      res.redirect('/welcome-settings?saved=1');
    });

    // إرسال رسالة تجريبية للروم المحفوظ (باستخدام بيانات البوت نفسه كمثال للعضو)
    app.post('/test-welcome-message', requireAuthWelcome, async (req, res) => {
      try {
        const settings = await getSettings();
        const guild = client.guilds.cache.first();
        if (!guild) return res.redirect('/welcome-settings?testError=تعذر العثور على السيرفر');

        const channel = guild.channels.cache.get(settings.channel_id);
        if (!channel) return res.redirect('/welcome-settings?testError=آيدي الروم غير صحيح أو غير محفوظ');

        const sampleMember = await guild.members.fetch(client.user.id);
        await channel.send(buildWelcomeMessage(settings, sampleMember));

        res.redirect('/welcome-settings?tested=1');
      } catch (err) {
        console.error('❌ خطأ أثناء إرسال رسالة الترحيب التجريبية:', err);
        res.redirect(`/welcome-settings?testError=${encodeURIComponent(err.message)}`);
      }
    });
  }

  console.log('👋 تم تحميل لوحة الترحيب بنجاح!');
};
