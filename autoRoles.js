// ==========================================================================
// 🟢 نظام الرتب التلقائية لشخص محدد عند الدخول (autoRoles.js) — ملف مستقل بالكامل
// لا يلمس أي جدول أو ملف قديم إطلاقاً: ينشئ جدوله الخاص هنا فقط، ويضيف
// صفحة جديدة على نفس سيرفر الداشبورد (app) الممرر له من index.js فقط.
// ==========================================================================
const { safeInteger } = require('./webSafety');

module.exports = function createAutoRoles(client, pool, app) {

  // ------------------------------------------------------------------------
  // 1. إنشاء جدول الرتب التلقائية الخاص به فقط (IF NOT EXISTS)
  // ------------------------------------------------------------------------
  async function initAutoRolesTable() {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS auto_roles (
          id SERIAL PRIMARY KEY,
          user_id VARCHAR(100),
          role_id VARCHAR(100)
        );
      `);

      console.log('🎭 تم تجهيز جدول الرتب التلقائية بنجاح!');
    } catch (err) {
      console.error('❌ خطأ أثناء إنشاء جدول الرتب التلقائية:', err);
    }
  }
  initAutoRolesTable();

  // ------------------------------------------------------------------------
  // 2. حدث انضمام عضو جديد للسيرفر — إعطاء الرتب التلقائية إن كان مُعرَّفاً بالجدول
  // ------------------------------------------------------------------------
  client.on('guildMemberAdd', async (member) => {
    try {
      const res = await pool.query('SELECT role_id FROM auto_roles WHERE user_id = $1', [member.id]);
      if (!res.rows.length) return;

      for (const row of res.rows) {
        const role = member.guild.roles.cache.get(row.role_id);
        if (role && role.editable) {
          await member.roles.add(role).catch(err => console.error('❌ خطأ أثناء إعطاء الرتبة التلقائية:', err));
        }
      }
    } catch (err) {
      console.error('❌ خطأ أثناء معالجة الرتب التلقائية عند انضمام عضو:', err);
    }
  });

  // ------------------------------------------------------------------------
  // 3. صفحة الموقع (Dashboard) الخاصة بالرتب التلقائية — على نفس app الموجود
  // لا تلمس أي روت قديم بـ dashboard.js، فقط تضيف روتات جديدة بمسارات جديدة.
  // ------------------------------------------------------------------------
  if (app) {
    const dashboardAuth = require('./dashboardAuth');
    const escapeHtml = require('./htmlEscape');

    function requireAuthAutoRoles(req, res, next) {
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
          input, select { width: 100%; padding: 10px; margin-top: 5px; border-radius: 6px; border: 1px solid #334155; background: #0f172a; color: #fff; box-sizing: border-box; }
          button { margin-top: 25px; width: 100%; padding: 12px; background: #0284c7; color: white; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; }
          .item { background:#0f172a; padding:12px 15px; border-radius:8px; margin-bottom:10px; border:1px solid #334155; display:flex; justify-content:space-between; align-items:center; }
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
            <a href="/welcome-settings">الترحيب 👋</a>
          </div>
          <a href="/logout" style="color:#ef4444; font-weight:bold; text-decoration:none;">تسجيل الخروج 🚪</a>
        </nav>
        <div class="container">${body}</div>
      </body>
      </html>
    `;

    // صفحة الرتب التلقائية
    app.get('/auto-roles', requireAuthAutoRoles, async (req, res) => {
      const rulesRes = await pool.query('SELECT * FROM auto_roles ORDER BY id ASC');
      const guild = client.guilds.cache.first();

      let rulesHTML = '';
      for (const r of rulesRes.rows) {
        const role = guild ? guild.roles.cache.get(r.role_id) : null;
        rulesHTML += `
          <div class="item">
            <span>👤 آيدي العضو: <code>${escapeHtml(r.user_id)}</code> ← الرتبة: <strong>${escapeHtml(role ? role.name : r.role_id)}</strong></span>
            <form method="POST" action="/delete-auto-role/${escapeHtml(r.id)}" style="display:inline; margin:0;"><button type="submit" onclick="return confirm('هل أنت متأكد من حذف هذه القاعدة؟')" style="background:#ef4444; color:white; padding:6px 12px; border-radius:5px; font-weight:bold; border:none; cursor:pointer; font-family:inherit; font-size:inherit;">🗑️ حذف</button></form>
          </div>
        `;
      }

      let rolesOptionsHTML = '';
      if (guild) {
        const assignableRoles = guild.roles.cache
          .filter(role => role.editable && role.id !== guild.id)
          .sort((a, b) => b.position - a.position);
        for (const role of assignableRoles.values()) {
          rolesOptionsHTML += `<option value="${role.id}">${escapeHtml(role.name)}</option>`;
        }
      }

      res.send(pageWrapper('الرتب التلقائية', `
        <h1>🎭 الرتب التلقائية لشخص محدد</h1>
        <p style="color:#94a3b8;">عند دخول العضو المحدد للسيرفر تُمنح له الرتبة المختارة تلقائياً.</p>
        ${rulesHTML || '<p style="color:#94a3b8;">لا توجد قواعد رتب تلقائية مضافة بعد.</p>'}
        <hr style="margin:25px 0; border-color:#334155;">
        <h2>➕ إضافة قاعدة رتبة تلقائية جديدة</h2>
        <form action="/add-auto-role" method="POST">
          <label>آيدي العضو:</label>
          <input type="text" name="userId" required>

          <label>الرتب (كل رتب السيرفر التي يقدر البوت يعطيها):</label>
          <button type="button" onclick="selectAllRoles()" style="margin-top:5px; width:100%; padding:10px; background:#334155; color:#f8fafc; border:none; border-radius:6px; font-weight:bold; cursor:pointer;">✅ تحديد كل الرتب</button>
          <select name="roleIds" id="rolesSelect" multiple size="10" required style="margin-top:10px;">
            ${rolesOptionsHTML}
          </select>
          <p style="color:#94a3b8; font-size:13px; margin-top:5px;">تقدر تحدد أكثر من رتبة بالضغط عليها مع الاستمرار بزر Ctrl (أو Cmd بالماك)، أو اضغط زر "تحديد كل الرتب" لتحديدها كلها دفعة وحدة.</p>

          <button type="submit">إضافة 💾</button>
        </form>
        <script>
          function selectAllRoles() {
            const select = document.getElementById('rolesSelect');
            for (const opt of select.options) opt.selected = true;
          }
        </script>
      `));
    });

    app.post('/add-auto-role', requireAuthAutoRoles, async (req, res) => {
      const { userId } = req.body || {};
      const cleanUserId = (userId || '').trim();

      // 🛡️ [إصلاح] بدون هذا التحقق كانت تُحفظ صفوف بآيدي عضو فارغ،
      // فتتراكم بيانات ميتة في الجدول ولا تُطبَّق على أحد إطلاقاً.
      if (!cleanUserId) return res.status(400).send('❌ آيدي العضو مطلوب!');

      // roleIds قد تصل كقيمة واحدة (رتبة واحدة محددة) أو كمصفوفة (عدة رتب محددة)
      let roleIds = (req.body && req.body.roleIds) || [];
      if (!Array.isArray(roleIds)) roleIds = [roleIds];

      for (const roleId of roleIds) {
        const cleanRoleId = (roleId || '').trim();
        if (!cleanRoleId) continue;
        await pool.query(`
          INSERT INTO auto_roles (user_id, role_id) VALUES ($1, $2);
        `, [cleanUserId, cleanRoleId]);
      }

      res.redirect('/auto-roles');
    });

    app.post('/delete-auto-role/:id', requireAuthAutoRoles, async (req, res) => {
      // 🛡️ [إصلاح] قيمة غير رقمية كانت تنتج NaN فيرفضه PostgreSQL ويبقى الطلب معلقاً
      const rowId = safeInteger(req.params.id);
      if (rowId === null) return res.status(400).send('❌ المعرّف غير صالح!');

      await pool.query('DELETE FROM auto_roles WHERE id = $1', [rowId]);
      res.redirect('/auto-roles');
    });
  }

  console.log('🎭 تم تحميل نظام الرتب التلقائية بنجاح!');
};
