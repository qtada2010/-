// ==========================================================================
// 🛡️ htmlEscape.js — تحويل الرموز الخاصة إلى HTML entities قبل عرض أي نص
// (من قاعدة البيانات أو من المستخدم) داخل صفحات لوحة التحكم، لمنع حقن الأكواد (XSS).
// ==========================================================================
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = escapeHtml;
