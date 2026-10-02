// ==========================================================================
// 🔐 dashboardAuth.js — مصادقة لوحة التحكم (مشتركة بين كل ملفات اللوحة)
// بدل وضع كلمة المرور نفسها داخل الكوكي، يُخزَّن توكن مشتق منها (HMAC-SHA256)،
// وتتم كل المقارنات بطريقة ثابتة الزمن (timingSafeEqual).
// ==========================================================================
const crypto = require('crypto');

const PASSWORD = process.env.DASHBOARD_PASSWORD || '';

function hmac(value) {
  return crypto.createHmac('sha256', PASSWORD || 'no-password').update(String(value)).digest();
}

function safeEqual(a, b) {
  return crypto.timingSafeEqual(hmac(a), hmac(b));
}

// التوكن الذي يُحفظ بالكوكي (لا يكشف كلمة المرور)
function makeToken() {
  return hmac('dashboard-session-v1').toString('hex');
}

// هل الكوكي المرسل يحمل توكناً صحيحاً؟
function isAuthed(req) {
  if (!PASSWORD) return false;
  const match = (req.headers.cookie || '').match(/(?:^|;\s*)auth_pass=([^;]*)/);
  return !!match && safeEqual(match[1], makeToken());
}

// هل كلمة المرور المُدخلة صحيحة؟
function checkPassword(input) {
  if (!PASSWORD || typeof input !== 'string') return false;
  return safeEqual(input, PASSWORD);
}

// خصائص الكوكي: HttpOnly + SameSite، و Secure فقط عند الاتصال عبر HTTPS (حتى لا يتعطل localhost)
function cookieAttributes(req) {
  const isHttps = req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
  return `Path=/; HttpOnly; SameSite=Lax${isHttps ? '; Secure' : ''}`;
}

// ==========================================================================
// 🚫 حد محاولات تسجيل الدخول الفاشلة (في الذاكرة، بدون مكتبات خارجية)
// بعد LOGIN_MAX_FAILS محاولة خاطئة خلال LOGIN_WINDOW_MS من نفس العنوان يُرفض الدخول مؤقتاً.
// ==========================================================================
const LOGIN_MAX_FAILS = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const loginFails = new Map(); // key -> { count, first }

// عنوان العميل: آخر عنوان في X-Forwarded-For (الذي أضافه الـ proxy ولا يستطيع العميل تزويره)
function clientKey(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
  return forwarded.length ? forwarded[forwarded.length - 1] : (req.socket && req.socket.remoteAddress) || 'unknown';
}

function getEntry(req) {
  const key = clientKey(req);
  const entry = loginFails.get(key);
  if (entry && Date.now() - entry.first > LOGIN_WINDOW_MS) {
    loginFails.delete(key);
    return null;
  }
  return entry || null;
}

function isLoginBlocked(req) {
  const entry = getEntry(req);
  return !!entry && entry.count >= LOGIN_MAX_FAILS;
}

function recordLoginFailure(req) {
  const entry = getEntry(req);
  if (entry) entry.count++;
  else loginFails.set(clientKey(req), { count: 1, first: Date.now() });
}

function clearLoginFailures(req) {
  loginFails.delete(clientKey(req));
}

// تنظيف دوري للسجلات المنتهية حتى لا تكبر الذاكرة
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of loginFails) {
    if (now - entry.first > LOGIN_WINDOW_MS) loginFails.delete(key);
  }
}, 10 * 60 * 1000).unref();

module.exports = { makeToken, isAuthed, checkPassword, cookieAttributes, isLoginBlocked, recordLoginFailure, clearLoginFailures };
