// ==========================================================================
// 🛡️ webSafety.js — طبقة حماية وأمان للوحة التحكم (Express)
//
// هذا الملف لا يغيّر سلوك أي صفحة أو أمر يعمل بشكل صحيح. وظيفته فقط:
//
//   1) منع تعليق الطلبات: في Express 4 إذا فشل معالج async فإن الوعد (Promise)
//      يُرفض بصمت ولا تُرسل أي استجابة أبداً، فيبقى المتصفح معلقاً للأبد.
//      هنا نلتقط الخطأ ونرسل صفحة خطأ مرتبة بدل التعليق.
//
//   2) حماية CSRF: إضافة توكن مخفي تلقائياً داخل كل فورم POST، والتحقق منه
//      قبل تنفيذ أي طلب POST. يمنع موقعاً خبيثاً من تنفيذ أوامر بالنيابة عنك
//      (حذف لوحة، تعديل صلاحيات، منح إكسبي...) أثناء كونك مسجّل الدخول.
//
//   3) أدوات تنقية مدخلات بسيطة (نص/رقم/لون/مسار) تمنع انهيار الصفحات عند
//      وصول بيانات ناقصة أو غير صالحة، دون رفض أي مدخل صالح.
// ==========================================================================
'use strict';

const crypto = require('crypto');
const zlib = require('zlib');

// --------------------------------------------------------------------------
// 1) التقاط أخطاء المعالجات غير المتزامنة (async) تلقائياً
// --------------------------------------------------------------------------

// يلفّ أي دالة معالجة حتى لو رمت خطأً أو رفضت وعداً، يُمرَّر الخطأ إلى next()
function wrapHandler(handler) {
  if (typeof handler !== 'function') return handler;
  // معالجات الأخطاء في Express لها 4 معاملات — لا تُلفّ
  if (handler.length >= 4) return handler;
  if (handler.__wrappedForSafety) return handler;

  const wrapped = function safeHandler(req, res, next) {
    let result;
    try {
      result = handler.call(this, req, res, next);
    } catch (error) {
      return next(error);
    }
    if (result && typeof result.then === 'function') {
      // .then(undefined, next) بدل .catch(next) حتى لا نبتلع أخطاء next نفسها
      result.then(undefined, next);
    }
    return result;
  };

  wrapped.__wrappedForSafety = true;
  return wrapped;
}

// يعدّل app.get / app.post ... لتلفّ معالجاتها تلقائياً.
// ملاحظة مهمة: app.get('اسم إعداد') بمعامل واحد هو قارئ إعدادات Express
// وليس تعريف مسار — لذلك لا نلمسه إطلاقاً.
function protectRouteRegistration(app) {
  const methods = ['get', 'post', 'put', 'patch', 'delete', 'all', 'use'];

  for (const method of methods) {
    const original = app[method];
    if (typeof original !== 'function') continue;

    app[method] = function patchedRouteMethod(...args) {
      // app.get('setting') — قارئ إعدادات، يُترك كما هو
      if (method === 'get' && args.length === 1) return original.apply(this, args);

      const safeArgs = args.map(arg => {
        if (typeof arg === 'function') return wrapHandler(arg);
        if (Array.isArray(arg)) return arg.map(item => (typeof item === 'function' ? wrapHandler(item) : item));
        return arg;
      });

      return original.apply(this, safeArgs);
    };
  }
}

// صفحة خطأ مرتبة بدل التعليق أو كشف تفاصيل الخادم
function renderErrorPage(statusCode, message) {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>خطأ ${statusCode}</title></head>
<body><main class="container"><h1>⚠️ خطأ ${statusCode}</h1>
<p class="muted">${message}</p>
<p><a href="/dashboard">العودة إلى لوحة التحكم</a></p></main></body></html>`;
}

// --------------------------------------------------------------------------
// ⚡ ضغط الاستجابات (gzip) — بلا أي اعتمادية خارجية
//
// صفحة /commands وحدها تقارب نصف مليون حرف (٦٤ بطاقة أمر)، فإرسالها كما هي
// يجعل فتحها بطيئاً على الشبكات العادية. ضغط gzip المدمج في Node يقلّصها نحو
// ٨٥٪ (من ~480KB إلى ~70KB) فيصبح فتح الصفحة أسرع بوضوح.
//
// لا يُضغط إلا ما يقبل المتصفح ضغطه ويتجاوز الحد الأدنى، ولا يُضغط ما هو
// مضغوط أصلاً (صور/ملفات)، ولا يُلمس أي ردّ صغير حتى لا يزيد حجماً.
// --------------------------------------------------------------------------
const COMPRESS_MIN_BYTES = 1024;
const COMPRESSIBLE = /^(?:text\/|application\/(?:json|javascript|xml)|image\/svg\+xml)/i;

function installCompression(app) {
  app.use((req, res, next) => {
    const accepted = String(req.headers['accept-encoding'] || '');
    if (!/\bgzip\b/.test(accepted)) return next();

    const originalSend = res.send;
    res.send = function compressedSend(body) {
      // res.json يمرّ من هنا أيضاً، فنضغط JSON كذلك
      if (typeof body !== 'string' && !Buffer.isBuffer(body)) return originalSend.call(this, body);
      if (res.headersSent || res.getHeader('Content-Encoding')) return originalSend.call(this, body);

      // Express يضع Content-Type داخل res.send، أي بعدنا. فإن لم يكن مضبوطاً
      // نستنتجه من المحتوى، وإلا وسم Express الرد المضغوط
      // application/octet-stream فلم يعرضه المتصفح كصفحة.
      let type = String(res.getHeader('Content-Type') || '');
      if (!type) {
        const head = Buffer.isBuffer(body) ? body.slice(0, 64).toString('utf8') : String(body).slice(0, 64);
        type = head.trimStart().startsWith('<') ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8';
      }
      if (!COMPRESSIBLE.test(type)) return originalSend.call(this, body);

      const payload = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
      if (payload.length < COMPRESS_MIN_BYTES) return originalSend.call(this, body);

      const compressed = zlib.gzipSync(payload, { level: 6 });
      res.setHeader('Content-Type', type);
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Content-Length', String(compressed.length));
      // الرد يختلف بحسب ترويسة الطلب، فلا يُخزَّن في وسيط مشترك بلا هذا
      const vary = res.getHeader('Vary');
      res.setHeader('Vary', vary ? String(vary) + ', Accept-Encoding' : 'Accept-Encoding');
      return originalSend.call(this, compressed);
    };

    return next();
  });
}

// يُسجَّل بعد كل المسارات (عبر setImmediate) حتى يلتقط أخطاء كل الملفات:
// dashboard.js و xp.js و welcome.js و autoRoles.js
function installErrorHandler(app) {
  setImmediate(() => {
    // 404 — مسار غير موجود
    app.use((req, res, next) => {
      if (res.headersSent) return next();
      res.status(404).send(renderErrorPage(404, 'الصفحة المطلوبة غير موجودة.'));
    });

    // معالج الأخطاء النهائي (4 معاملات = معالج أخطاء في Express)
    app.use((err, req, res, next) => {
      console.error(`❌ خطأ في مسار لوحة التحكم ${req.method} ${req.originalUrl}:`, err);
      if (res.headersSent) return next(err);
      res.status(500).send(renderErrorPage(500, 'حدث خطأ غير متوقع أثناء معالجة الطلب. تم تسجيل الخطأ في سجلات البوت.'));
    });
  });
}

// --------------------------------------------------------------------------
// 2) حماية CSRF
// --------------------------------------------------------------------------

const CSRF_FIELD = '_csrf';
const CSRF_HEADER = 'x-csrf-token';

// التوكن مشتق من كلمة مرور اللوحة، فلا يمكن لمهاجم خارجي تخمينه.
function buildCsrfToken(secret) {
  return crypto.createHmac('sha256', secret || 'no-password').update('dashboard-csrf-v1').digest('hex');
}

function timingSafeCompare(a, b) {
  const bufferA = Buffer.from(String(a));
  const bufferB = Buffer.from(String(b));
  if (bufferA.length !== bufferB.length) return false;
  return crypto.timingSafeEqual(bufferA, bufferB);
}

// حقن حقل مخفي داخل كل فورم POST تلقائياً — لا حاجة لتعديل أي صفحة يدوياً
function injectCsrfIntoForms(html, token) {
  if (typeof html !== 'string' || html.indexOf('<form') === -1) return html;
  return html.replace(/<form\b[^>]*>/gi, (formTag) => {
    // فورمات GET لا تحتاج توكن
    if (!/method\s*=\s*["']?post["']?/i.test(formTag)) return formTag;
    // لا نكرر الحقن إن كان موجوداً
    if (formTag.indexOf(CSRF_FIELD) !== -1) return formTag;
    return `${formTag}<input type="hidden" name="${CSRF_FIELD}" value="${token}">`;
  });
}

// يُركَّب قبل تعريف المسارات: يتحقق من التوكن في كل POST، ويحقنه في كل صفحة
function protectAgainstCsrf(app, secret) {
  const token = buildCsrfToken(secret);

  app.use((req, res, next) => {
    // حقن التوكن في مخرجات HTML
    const originalSend = res.send;
    res.send = function csrfAwareSend(body) {
      if (typeof body === 'string') body = injectCsrfIntoForms(body, token);
      return originalSend.call(this, body);
    };

    // الطرق الآمنة (قراءة فقط) لا تحتاج تحققاً
    if (req.method !== 'POST' && req.method !== 'PUT' && req.method !== 'PATCH' && req.method !== 'DELETE') {
      return next();
    }

    const provided = (req.body && req.body[CSRF_FIELD]) || req.headers[CSRF_HEADER] || '';
    if (provided && timingSafeCompare(provided, token)) {
      // لا نترك التوكن داخل req.body حتى لا يتسرب إلى أي استعلام يقرأ كل الحقول
      if (req.body && Object.prototype.hasOwnProperty.call(req.body, CSRF_FIELD)) delete req.body[CSRF_FIELD];
      return next();
    }

    console.warn(`⚠️ تم رفض طلب ${req.method} ${req.originalUrl} بسبب توكن CSRF مفقود أو غير صالح.`);
    return res.status(403).send(renderErrorPage(403, 'انتهت صلاحية الصفحة أو الطلب غير موثوق. أعد تحميل الصفحة ثم حاول مرة أخرى.'));
  });

  return token;
}

// --------------------------------------------------------------------------
// 3) أدوات تنقية المدخلات
// --------------------------------------------------------------------------

// نص مُقلَّم بأمان: يتعامل مع undefined/null/أرقام دون أن يرمي خطأ
function safeText(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  if (Array.isArray(value)) value = value[0];
  if (value === undefined || value === null) return fallback;
  const text = String(value).trim();
  return text === '' ? fallback : text;
}

// نفس السابق لكن يُرجع null بدل نص فارغ (مناسب لأعمدة قاعدة البيانات)
function safeTextOrNull(value) {
  const text = safeText(value, '');
  return text === '' ? null : text;
}

// عدد صحيح آمن: يمنع تمرير NaN إلى PostgreSQL (وهو خطأ يُفشل الاستعلام)
function safeInteger(value, fallback = null) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// لون hex صالح فقط — يمنع انهيار EmbedBuilder.setColor عند قيمة تالفة
function safeHexColor(value, fallback = '#0284c7') {
  const text = safeText(value, '');
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text : fallback;
}

// جزء مسار آمن للاستخدام داخل res.redirect — يمنع إعادة التوجيه لموقع خارجي
function safePathSegment(value) {
  return encodeURIComponent(safeText(value, ''));
}

module.exports = {
  protectRouteRegistration,
  installCompression,
  installErrorHandler,
  protectAgainstCsrf,
  safeText,
  safeTextOrNull,
  safeInteger,
  safeHexColor,
  safePathSegment,
  CSRF_FIELD
};
