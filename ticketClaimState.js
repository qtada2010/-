// ==========================================================================
// 🟢 حالة استلام التذاكر (ticketClaimState.js) — ملف مستقل بالكامل
// بديل عن تخزين حالة الاستلام بموضوع (topic) القناة: تعديل موضوع/اسم القناة
// بديسكورد محكوم برايت ليمت صارم جداً (تقريباً مرتين كل 10 دقائق للقناة
// الواحدة)، وكان هذا يسبب تعطل/تعليق زر "إلغاء الاستلام" (وزر الاستلام نفسه
// عند تكراره) بسبب انتظار الطلب المحكوم بالرايت ليمت لحين تجاوز الـ3 ثواني
// المسموحة للرد على التفاعل. الآن تُخزَّن حالة الاستلام بجدول منفصل بقاعدة
// البيانات فقط (بدون أي حد على عدد التحديثات)، ولا نلمس topic القناة إطلاقاً.
// ==========================================================================
module.exports = function createTicketClaimState(pool) {

  async function initTable() {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ticket_claims (
          channel_id VARCHAR(100) PRIMARY KEY,
          claimed_admin_by VARCHAR(100),
          claimed_mediator_by VARCHAR(100)
        );
      `);

      // 🟢 [إصلاح] في حال كان الجدول موجوداً مسبقاً بدون هذين العمودين (مثلاً من نسخة أقدم)،
      // CREATE TABLE IF NOT EXISTS لا يضيفهما، فنضيفهما هنا صراحةً لضمان وجودهما دائماً
      await pool.query(`
        ALTER TABLE ticket_claims ADD COLUMN IF NOT EXISTS claimed_admin_by VARCHAR(100);
        ALTER TABLE ticket_claims ADD COLUMN IF NOT EXISTS claimed_mediator_by VARCHAR(100);
      `);
    } catch (err) {
      console.error('❌ خطأ أثناء إنشاء جدول حالة استلام التذاكر:', err);
    }
  }
  initTable();

  async function getClaimState(channelId) {
    const res = await pool.query('SELECT * FROM ticket_claims WHERE channel_id = $1', [channelId]);
    return res.rows[0] || { channel_id: channelId, claimed_admin_by: null, claimed_mediator_by: null };
  }

  async function setClaimedAdmin(channelId, userId) {
    await pool.query(`
      INSERT INTO ticket_claims (channel_id, claimed_admin_by) VALUES ($1, $2)
      ON CONFLICT (channel_id) DO UPDATE SET claimed_admin_by = $2;
    `, [channelId, userId]);
  }

  async function setClaimedMediator(channelId, userId) {
    await pool.query(`
      INSERT INTO ticket_claims (channel_id, claimed_mediator_by) VALUES ($1, $2)
      ON CONFLICT (channel_id) DO UPDATE SET claimed_mediator_by = $2;
    `, [channelId, userId]);
  }

  return { getClaimState, setClaimedAdmin, setClaimedMediator };
};
