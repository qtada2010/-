'use strict';
// ==========================================================================
// 🧪 mockEnvironment.js — بيئة وهمية لتشغيل لوحة التحكم بلا اعتماديات
//
// توفّر pool وهمياً (بلا PostgreSQL) و client ديسكورد وهمياً (بلا إنترنت)،
// بقيم ثابتة تماماً حتى تكون كل عملية عرض قابلة للتكرار بالضبط.
// يستخدمها كلٌّ من renderSnapshots.js و previewDashboard.js حتى لا يتكرر
// التعريف في مكانين ويتفرّقا مع الوقت.
//
// ⚠️ أداة تطوير فقط — لا يستوردها البوت ولا تعمل في الإنتاج إطلاقاً.
// ==========================================================================

// --------------------------------------------------------------------------
// صفوف ثابتة لكل جدول، تكفي لعرض كل صفحات اللوحة بمحتوى واقعي
// --------------------------------------------------------------------------
const FIXED_ROWS = {
  permissions: [{
    key: 'main_permissions',
    tax_role_id: '100000000000000001',
    come_role_id: '100000000000000002',
    say_role_id: '100000000000000003',
    close_permission: 'both',
    all_commands_role_id: '100000000000000004',
    clan_cmd_role_id: '100000000000000005',
    clear_cleanup_mode: 'bot_only'
  }],
  // ⚠️ أسماء الأعمدة هنا يجب أن تطابق مخطط database.js حرفياً.
  // كانت هذه الصفوف تستخدم (id / name / style) بينما الجدول الحقيقي يستخدم
  // (panel_id / type / message_type)، فكانت كل لقطة لصفحة /panel و/edit-panel
  // تُصيَّر بمعرّف undefined وروابط تعديل وحذف مكسورة — أي أن أداة التحقق
  // نفسها كانت تعرض صفحة مكسورة لا تماثل الإنتاج.
  panels: [{
    panel_id: '1', channel_id: '200000000000000001', category_id: '300000000000000001',
    admin_role_id: '100000000000000001', high_admin_role_id: '100000000000000002',
    log_channel_id: '500000000000000001',
    title: 'عنوان', description: 'وصف',
    type: 'select', message_type: 'embed',
    image_url: '', color: '#4f46e5', last_message_id: '',
    claim_admin_enabled: false, claim_mediator_enabled: false,
    mediator_role_id: '100000000000000002'
  }],
  panel_options: [{
    id: 1, panel_id: '1', option_id: '1', label: 'خيار', description: 'وصف الخيار',
    emoji: '🎫', welcome_message: 'مرحباً بتذكرتك', button_style: 'Primary',
    category_id: '300000000000000001'
  }],
  bot_settings: [{ key: 'default', value: '{}' }],
  apply_setup: [{ id: 1 }],
  stats: [],
  claim_stats: [],
  suggestion_votes: []
};

/** يستخرج اسم الجدول من نص الاستعلام حتى نُرجع صفوفاً مناسبة له */
function tableOf(sql) {
  const match = String(sql).match(/\b(?:FROM|INTO|UPDATE)\s+"?([a-z_]+)"?/i);
  return match ? match[1].toLowerCase() : '';
}

/**
 * pool وهمي.
 *
 * الوضع الافتراضي (persist: false) عديم الذاكرة: كل استعلام يُرجع صفوفاً
 * ثابتة والكتابة تُهمَل. هذا ما تحتاجه لقطات الصفحات حتى تكون مخرجاتها
 * قابلة للتكرار بالضبط.
 *
 * ⚠️ لكن ذلك الوضع يُربك من يجرّب اللوحة يدوياً: الحفظ يرد 302 «نجح» ثم
 * يعود الحقل فارغاً، فيبدو وكأن الحفظ معطوب وهو سليم تماماً. لذلك تعمل
 * المعاينة بـ persist: true فتحتفظ بالكتابات في الذاكرة طوال تشغيل
 * العملية، ويصبح سلوكها مطابقاً لقاعدة بيانات حقيقية.
 *
 * تبقى البيانات في الذاكرة فقط: تُفقد عند إيقاف المعاينة، ولا علاقة لها
 * بقاعدة بيانات البوت الحقيقية إطلاقاً.
 */
function createMockPool(options = {}) {
  const persist = Boolean(options.persist);
  // نسخة قابلة للتعديل من الصفوف الثابتة، تُستعمل في وضع الحفظ فقط
  const tables = JSON.parse(JSON.stringify(FIXED_ROWS));

  async function query(sql, params = []) {
    const text = String(sql);
    const table = tableOf(text);

    // 📊 استعلامات العدّ (SELECT COUNT(*) …) لا تُرجع صفوف الجدول بل رقماً
    // واحداً. بدون هذه الحالة يعود optionsCount في صفحة /panel بـ undefined
    // فيظهر «الخيارات: undefined» في كل لقطة ومعاينة.
    if (/^\s*SELECT\s+COUNT\s*\(/i.test(text)) {
      const source = persist ? (tables[table] || []) : (FIXED_ROWS[table] || []);
      return { rows: [{ count: String(source.length) }], rowCount: 1 };
    }

    if (!persist) {
      const rows = FIXED_ROWS[table] || [];
      return { rows, rowCount: rows.length };
    }

    // --- bot_settings: جدول مفتاح/قيمة، وهو مستودع كل إعدادات الأوامر ---
    if (table === 'bot_settings') {
      const rows = tables.bot_settings;

      if (/^\s*INSERT/i.test(text)) {
        // الصيغة المستعملة في الكود: VALUES ($1, $2) ON CONFLICT (key) DO UPDATE
        // وأحياناً يكون المفتاح مكتوباً حرفياً والقيمة في $1.
        const literalKey = text.match(/VALUES\s*\(\s*'([^']+)'/);
        const key = literalKey ? literalKey[1] : params[0];
        const value = literalKey ? params[0] : params[1];
        const existing = rows.find(row => row.key === key);
        if (existing) existing.value = value;
        else rows.push({ key, value });
        return { rows: [], rowCount: 1 };
      }

      // SELECT ... WHERE key = ANY($1::text[])
      if (/ANY\s*\(/i.test(text) && Array.isArray(params[0])) {
        const wanted = params[0];
        const found = rows.filter(row => wanted.includes(row.key));
        return { rows: found, rowCount: found.length };
      }

      // SELECT ... WHERE key = $1
      if (/WHERE\s+key\s*=\s*\$1/i.test(text)) {
        const found = rows.filter(row => row.key === params[0]);
        return { rows: found, rowCount: found.length };
      }

      return { rows, rowCount: rows.length };
    }

    // --- permissions: صف واحد، التحديث يدمج الأعمدة المذكورة ---
    if (table === 'permissions' && /^\s*(UPDATE|INSERT)/i.test(text)) {
      const row = tables.permissions[0];
      const columns = [...text.matchAll(/([a-z_]+)\s*=\s*\$(\d+)/gi)];
      columns.forEach(([, column, index]) => { row[column] = params[Number(index) - 1]; });
      return { rows: [row], rowCount: 1 };
    }

    if (/^\s*(INSERT|UPDATE|DELETE)/i.test(text)) return { rows: [], rowCount: 1 };

    const rows = tables[table] || [];
    return { rows, rowCount: rows.length };
  }

  const pool = {
    query,
    async connect() { return { query, release() {} }; },
    on() {}
  };
  return pool;
}

// --------------------------------------------------------------------------
// مجموعة تحاكي Collection الخاصة بـ discord.js بالقدر الذي تستخدمه اللوحة
// --------------------------------------------------------------------------
function createCache(items) {
  const map = new Map(items.map(item => [item.id, item]));
  map.filter = fn => createCache([...map.values()].filter(fn));
  map.find = fn => [...map.values()].find(fn);
  map.map = fn => [...map.values()].map(fn);
  map.sort = fn => createCache([...map.values()].sort(fn));
  map.first = () => [...map.values()][0];
  return map;
}

function createMockClient() {
  const roles = createCache([
    { id: '400000000000000001', name: 'الإدارة', position: 10, managed: false, color: 0xb99b6d },
    { id: '400000000000000002', name: 'الوسطاء', position: 9, managed: false, color: 0x7fbf8f },
    { id: '400000000000000003', name: 'Color أحمر', position: 8, managed: false, color: 0xe08c8c }
  ]);

  const channels = createCache([
    { id: '500000000000000001', name: 'عام', type: 0, parentId: null },
    { id: '500000000000000002', name: 'التذاكر', type: 4, parentId: null }
  ]);

  const guild = {
    id: '600000000000000001',
    name: 'سيرفر الاختبار',
    memberCount: 1234,
    roles: { cache: roles, everyone: { id: '600000000000000001' } },
    channels: { cache: channels, fetch: async id => channels.get(id) || null },
    members: { cache: createCache([]), fetch: async () => createCache([]) },
    iconURL: () => 'https://example.test/icon.png'
  };

  return {
    user: {
      id: '700000000000000001',
      username: 'ON',
      displayAvatarURL: () => 'https://example.test/avatar.png'
    },
    guilds: { cache: createCache([guild]) },
    channels: { fetch: async id => channels.get(id) || null },
    on() {},
    once() {}
  };
}

/** يضبط متغيرات البيئة بقيم ثابتة حتى لا تتغير المخرجات بين التشغيلات */
function applyFixedEnvironment() {
  process.env.DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'snapshot-test-password';
  process.env.DASHBOARD_URL = process.env.DASHBOARD_URL || 'https://example.test';
  process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN || 'snapshot-token';
}

module.exports = { createMockPool, createMockClient, applyFixedEnvironment };
