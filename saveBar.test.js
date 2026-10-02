'use strict';

// ============================================================================
// اختبارات شريط الحفظ الموحّد
//
// المنهج: لا نقرأ الكود ونفترض أنه يعمل — بل نستخرج السكربت الفعلي الذي
// يُرسَل إلى المتصفح من صفحة /commands المُصيَّرة، ونشغّله في vm فوق DOM
// مصغّر. هذا يكشف أخطاء ابتلاع الشرطة المائلة في القوالب النصية، وهي
// العلّة التي سبق أن أسقطت سكربت الصفحة بالكامل.
//
// لا نستخدم jsdom عمداً: إضافة اعتمادية ثقيلة لاختبار واحد غير مبرَّرة،
// والشريط لا يحتاج إلا جزءاً صغيراً جداً من واجهة DOM.
// ============================================================================

const test = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const http = require('node:http');

const { createMockPool, createMockClient, applyFixedEnvironment } = require('./mockEnvironment');

applyFixedEnvironment();
process.env.PORT = '0'; // dashboard.js يستمع عند التحميل — منفذ حر عشوائي

// dashboard.js ينادي app.listen بنفسه وذلك يُبقي العملية حيّة فلا ينتهي
// الاختبار. نلتقط الخادم ونرفع تثبيته. (نفس حيلة dashboardScripts.test.js)
const express = require('express');
const originalListen = express.application.listen;
const openedServers = [];
express.application.listen = function capturedListen(...args) {
  const server = originalListen.apply(this, args);
  openedServers.push(server);
  server.unref();
  return server;
};
const app = require('./dashboard')(createMockPool(), createMockClient());
express.application.listen = originalListen;

const authCookie = `auth_pass=${require('./dashboardAuth').makeToken()}`;

/** يجلب /commands من الخادم الحيّ — لا من لقطة قد تكون قديمة. */
function fetchCommandsPage() {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      http.get({ host: '127.0.0.1', port, path: '/commands', headers: { cookie: authCookie } }, response => {
        // Buffer.concat إلزامي: الجمع النصي يكسر الحروف العربية عند حدود الأجزاء.
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => { server.close(); resolve(Buffer.concat(chunks).toString('utf8')); });
      }).on('error', error => { server.close(); reject(error); });
    });
  });
}

let pageHtml = '';
test.before(async () => { pageHtml = await fetchCommandsPage(); });
test.after(() => { openedServers.forEach(server => server.close()); });

// ----------------------------- DOM مصغّر -----------------------------------

class ClassList {
  constructor() { this.set = new Set(); }
  add(...names) { names.forEach(n => this.set.add(n)); }
  remove(...names) { names.forEach(n => this.set.delete(n)); }
  contains(name) { return this.set.has(name); }
}

class Element {
  constructor(tag, attrs = {}) {
    this.tagName = tag.toUpperCase();
    this.attrs = attrs;
    this.children = [];
    this.parent = null;
    this.classList = new ClassList();
    this.listeners = {};
    this.textContent = '';
    this.hidden = false;
    this.disabled = false;
    // dataset يعكس سمات data-* كما في المتصفح
    this.dataset = new Proxy(this.attrs, {
      get: (target, key) => target['data-' + String(key).replace(/[A-Z]/g, c => '-' + c.toLowerCase())],
      set: (target, key, value) => {
        target['data-' + String(key).replace(/[A-Z]/g, c => '-' + c.toLowerCase())] = value;
        return true;
      }
    });
    (attrs.class || '').split(' ').filter(Boolean).forEach(c => this.classList.add(c));
  }
  append(child) { child.parent = this; this.children.push(child); return child; }
  appendChild(child) { return this.append(child); }
  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter(c => c !== this);
    this.parent = null;
  }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; }
  setAttribute(name, value) { this.attrs[name] = value; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  dispatchEvent(event) {
    event.target = event.target || this;
    let node = this;
    while (node) {
      (node.listeners[event.type] || []).forEach(fn => fn.call(node, event));
      node = event.bubbles ? node.parent : null;
    }
    return true;
  }
  get descendants() {
    return this.children.flatMap(c => [c, ...c.descendants]);
  }
  matchesSimple(selector) {
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    const attr = selector.match(/^([a-z]*)\[([a-z-]+)(?:="([^"]*)")?\]$/i);
    if (attr) {
      const [, tag, name, value] = attr;
      if (tag && this.tagName !== tag.toUpperCase()) return false;
      if (!Object.prototype.hasOwnProperty.call(this.attrs, name)) return false;
      return value === undefined || this.attrs[name] === value;
    }
    return this.tagName === selector.toUpperCase();
  }
  // يدعم محدِّد السليل مثل '.cmd-card form' كما تفعل المتصفحات فعلاً،
  // فالكود المُختبَر يستعمل closest('.cmd-card form').
  matches(selector) {
    const parts = selector.trim().split(/\s+/);
    if (!this.matchesSimple(parts[parts.length - 1])) return false;
    let node = this.parent;
    for (let i = parts.length - 2; i >= 0; i -= 1) {
      while (node && !node.matchesSimple(parts[i])) node = node.parent;
      if (!node) return false;
      node = node.parent;
    }
    return true;
  }
  querySelectorAll(selector) {
    return this.descendants.filter(el => el.matches(selector));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) {
    let node = this;
    while (node) { if (node.matches && node.matches(selector)) return node; node = node.parent; }
    return null;
  }
}

class Field extends Element {
  constructor(name, value, type = 'text') {
    super('input', { name, type });
    this.name = name;
    this.value = value;
    this.type = type;
    this.checked = type === 'checkbox' ? Boolean(value) : false;
  }
}

class FormElement extends Element {
  constructor(action, fields) {
    super('form', { action, method: 'POST' });
    this.elements = fields;
    fields.forEach(f => this.append(f));
  }
}

/**
 * يبني صفحة فيها بطاقتا أمر، كل واحدة بفورم فيه حقول.
 *
 * options.aliasCanonical: يضع حقل الاختصارات داخل محرّر اختصارات حقيقي
 * (data-alias-editor) باسم أمر معلوم، كما في الصفحة الفعلية — لأن المقارنة
 * بعد الحفظ تعتمد على قواعد ذلك المحرّر.
 */
function buildPage(options = {}) {
  const body = new Element('body');

  const bar = new Element('div', { 'data-save-bar': '' });
  bar.hidden = true;
  const text = new Element('span', { 'data-save-bar-text': '', class: 'save-bar-text' });
  const saveButton = new Element('button', { 'data-save-all': '' });
  const cancelButton = new Element('button', { 'data-save-cancel': '' });
  bar.append(text); bar.append(saveButton); bar.append(cancelButton);
  body.append(bar);

  const cards = [];
  [['ban', 'الحظر'], ['role', 'الرتب']].forEach(([slug, title]) => {
    const card = new Element('section', { class: 'card cmd-card' });
    const name = new Element('h3', { class: 'cmd-name' });
    name.textContent = title;
    card.append(name);
    const aliasField = new Field('aliases', '');
    const form = new FormElement('/save-slash-command/' + slug, [
      new Field('_csrf', 'token-123'),
      aliasField,
      new Field('enabled', true, 'checkbox')
    ]);
    if (options.aliasCanonical) {
      // الحقل داخل محرّر اختصارات: هو ما يجعل المقارنة تراعي قواعد الخادم
      const editor = new Element('div', {
        class: 'alias-editor',
        'data-alias-editor': '',
        'data-canonical': options.aliasCanonical,
        'data-blocked-canonical': options.blockedCanonical ? '1' : null
      });
      if (!options.blockedCanonical) delete editor.attrs['data-blocked-canonical'];
      form.append(editor);
      editor.append(aliasField);
    }
    const submitButton = new Element('button', { type: 'submit' });
    submitButton.textContent = 'حفظ';
    form.append(submitButton);
    // إرسال أصلي ينقل الصفحة — نعدّه لنكشف إن كان الزر ما زال ينتقل
    form.nativeSubmits = 0;
    form.submit = () => { form.nativeSubmits += 1; };
    card.append(form);
    body.append(card);
    cards.push({ card, form, title, submitButton });
  });

  const document = {
    body,
    listeners: {},
    querySelector: s => body.querySelector(s),
    querySelectorAll: s => body.querySelectorAll(s),
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    fire(type, target) { (this.listeners[type] || []).forEach(fn => fn({ type, target })); }
  };

  return { document, bar, text, saveButton, cancelButton, cards };
}

// -------------------------- استخراج السكربت --------------------------------

function extractSaveBarScript() {
  const scripts = [...pageHtml.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  const host = scripts.find(s => s.includes('data-save-bar'));
  assert.ok(host, 'لم يُعثر على سكربت شريط الحفظ في الصفحة المُصيَّرة');
  const start = host.indexOf('(() => {\n          const bar = document.querySelector');
  assert.ok(start >= 0, 'لم يُعثر على بداية دالة الشريط');
  const end = host.indexOf('})();', start);
  return host.slice(start, end + 5);
}

function run(page, fetchImpl) {
  const requests = [];
  const windowListeners = {};
  page.window = {
    // التحقق بعد الحفظ يعيد قراءة نفس المسار، فيحتاج location كما في المتصفح
    location: { pathname: page.windowPathname || '/commands' },
    addEventListener(type, fn) { (windowListeners[type] = windowListeners[type] || []).push(fn); },
    /** يحاكي محاولة مغادرة الصفحة ويُرجع true إن اعترضها المتصفح بتحذير */
    leave() {
      let blocked = false;
      const event = { type: 'beforeunload', preventDefault() { blocked = true; }, returnValue: undefined };
      (windowListeners.beforeunload || []).forEach(fn => fn(event));
      return blocked;
    }
  };
  const sandbox = {
    document: page.document,
    window: page.window,
    // الصفحة المقروءة بعد الحفظ (GET) تُحلَّل بـ DOMParser في المتصفح.
    // نُزوّد الاختبار ببديل مصغّر يعيد page.fresh كما يضبطه الاختبار نفسه.
    DOMParser: class {
      parseFromString() {
        return page.fresh || { querySelector: () => null };
      }
    },
    setTimeout: () => {},
    Event: class { constructor(type, init = {}) { this.type = type; this.bubbles = Boolean(init.bubbles); } },
    CustomEvent: class { constructor(type, init = {}) { this.type = type; this.bubbles = Boolean(init.bubbles); } },
    FormData: class { constructor(form) { this.form = form; } },
    URLSearchParams: class {
      constructor(formData) {
        this.pairs = formData.form.elements
          .filter(el => el.type !== 'checkbox' || el.checked)
          .map(el => [el.name, el.type === 'checkbox' ? 'on' : el.value]);
      }
      toString() { return this.pairs.map(([k, v]) => k + '=' + v).join('&'); }
    },
    fetch: async (url, options) => {
      // requests تُعدّ طلبات الحفظ (POST) وحدها. طلب التحقق بعد الحفظ (GET)
      // وطلب /save-health ليسا حفظاً، فلا يُحسبان في العدّ.
      if (!options || options.method !== 'POST') {
        return fetchImpl ? fetchImpl(url, options) : { ok: true, status: 200, text: async () => '' };
      }
      requests.push({ url, body: options.body ? options.body.toString() : '' });
      return fetchImpl ? fetchImpl(url, options) : { ok: true, status: 200 };
    },
    console
  };
  vm.createContext(sandbox);
  new vm.Script(extractSaveBarScript()).runInContext(sandbox);
  return requests;
}

const settle = () => new Promise(resolve => setImmediate(() => setImmediate(resolve)));

// ------------------------------ الاختبارات ---------------------------------

test('الشريط مخفي عند فتح الصفحة بلا تعديلات', () => {
  const page = buildPage();
  run(page);
  assert.strictEqual(page.bar.hidden, true);
});

test('أول تعديل يُظهر الشريط ويسمّي الأمر المعدَّل', () => {
  const page = buildPage();
  run(page);
  const form = page.cards[0].form;
  form.elements[1].value = 'لف';
  page.document.fire('input', form.elements[1]);
  assert.strictEqual(page.bar.hidden, false);
  assert.match(page.text.textContent, /الحظر/);
});

test('تعديل أمرين يعرض العدد لا الاسم', () => {
  const page = buildPage();
  run(page);
  page.cards.forEach((c, i) => {
    c.form.elements[1].value = 'س' + i;
    page.document.fire('input', c.form.elements[1]);
  });
  assert.match(page.text.textContent, /2 أوامر/);
});

test('البطاقة المعدَّلة تُعلَّم بـ is-dirty والسليمة لا', () => {
  const page = buildPage();
  run(page);
  page.cards[0].form.elements[1].value = 'لف';
  page.document.fire('input', page.cards[0].form.elements[1]);
  assert.ok(page.cards[0].card.classList.contains('is-dirty'));
  assert.ok(!page.cards[1].card.classList.contains('is-dirty'));
});

test('إرجاع الحقل لقيمته الأصلية يُخفي الشريط من جديد', () => {
  const page = buildPage();
  run(page);
  const field = page.cards[0].form.elements[1];
  field.value = 'لف';
  page.document.fire('input', field);
  assert.strictEqual(page.bar.hidden, false);
  field.value = '';
  page.document.fire('input', field);
  assert.strictEqual(page.bar.hidden, true, 'الشريط يجب أن يختفي عند زوال التعديل');
});

test('مربع الاختيار يُرصد كتعديل مثل الحقل النصي', () => {
  const page = buildPage();
  run(page);
  const box = page.cards[0].form.elements[2];
  box.checked = !box.checked;
  page.document.fire('change', box);
  assert.strictEqual(page.bar.hidden, false);
});

test('«إلغاء التغييرات» يُعيد كل القيم ويُخفي الشريط', () => {
  const page = buildPage();
  run(page);
  const form = page.cards[0].form;
  form.elements[1].value = 'لف';
  form.elements[2].checked = false;
  page.document.fire('input', form.elements[1]);

  page.cancelButton.dispatchEvent({ type: 'click' });

  assert.strictEqual(form.elements[1].value, '', 'الحقل النصي يعود فارغاً');
  assert.strictEqual(form.elements[2].checked, true, 'مربع الاختيار يعود لحالته');
  assert.strictEqual(page.bar.hidden, true);
});

test('الحفظ يرسل الأوامر المعدَّلة فقط', async () => {
  const page = buildPage();
  const requests = run(page);
  page.cards[0].form.elements[1].value = 'لف';
  page.document.fire('input', page.cards[0].form.elements[1]);

  page.saveButton.dispatchEvent({ type: 'click' });
  await settle();

  assert.strictEqual(requests.length, 1, 'أمر واحد فقط تغيّر فيُرسل وحده');
  assert.strictEqual(requests[0].url, '/save-slash-command/ban');
});

test('كل طلب يحمل رمز الحماية _csrf', async () => {
  const page = buildPage();
  const requests = run(page);
  page.cards[0].form.elements[1].value = 'لف';
  page.document.fire('input', page.cards[0].form.elements[1]);
  page.saveButton.dispatchEvent({ type: 'click' });
  await settle();
  assert.match(requests[0].body, /_csrf=token-123/);
});

test('تعديل أمرين يُرسل طلبين في ضغطة واحدة', async () => {
  const page = buildPage();
  const requests = run(page);
  page.cards.forEach((c, i) => {
    c.form.elements[1].value = 'س' + i;
    page.document.fire('input', c.form.elements[1]);
  });
  page.saveButton.dispatchEvent({ type: 'click' });
  await settle();
  assert.strictEqual(requests.length, 2);
  assert.deepStrictEqual(requests.map(r => r.url).sort(),
    ['/save-slash-command/ban', '/save-slash-command/role']);
});

test('بعد نجاح الحفظ تُمسح علامة is-dirty', async () => {
  const page = buildPage();
  run(page);
  page.cards[0].form.elements[1].value = 'لف';
  page.document.fire('input', page.cards[0].form.elements[1]);
  page.saveButton.dispatchEvent({ type: 'click' });
  await settle();
  assert.ok(!page.cards[0].card.classList.contains('is-dirty'));
});

test('فشل الحفظ يُبقي البطاقة معلَّمة ويعرض الخطأ', async () => {
  const page = buildPage();
  run(page, () => ({ ok: false, status: 500 }));
  page.cards[0].form.elements[1].value = 'لف';
  page.document.fire('input', page.cards[0].form.elements[1]);
  page.saveButton.dispatchEvent({ type: 'click' });
  await settle();

  assert.ok(page.bar.classList.contains('is-error'), 'الشريط يدخل حالة الخطأ');
  assert.match(page.text.textContent, /الحظر/, 'يُسمّى الأمر الذي فشل');
  assert.ok(page.cards[0].card.classList.contains('is-dirty'),
    'التعديل يبقى معلَّماً حتى لا يظن المستخدم أنه حُفظ');
});

test('الضغط على حفظ بلا تعديلات لا يرسل شيئاً', async () => {
  const page = buildPage();
  const requests = run(page);
  page.saveButton.dispatchEvent({ type: 'click' });
  await settle();
  assert.strictEqual(requests.length, 0);
});

// ===========================================================================
// منع الاختلاط بين زر البطاقة وشريط الحفظ
//
// هذه المجموعة تقفل العطل الحقيقي الذي أبلغ عنه المستخدم: كان زر البطاقة
// يُرسل الفورم إرسالاً أصلياً فينقل الصفحة، ويعترضه حارس المغادرة بتحذير
// «تغييراتك قد لا تُحفظ»، فيضغط المستخدم «ابقَ» ولا يُحفظ شيء إطلاقاً.
// ===========================================================================

test('زر البطاقة يحفظ عبر fetch ولا ينقل الصفحة', async () => {
  const page = buildPage();
  const requests = run(page);
  const card = page.cards[0];
  card.form.elements[1].value = 'لف';
  page.document.fire('input', card.form.elements[1]);

  card.form.dispatchEvent({ type: 'submit', bubbles: true, preventDefault() { this.prevented = true; } });
  await settle();

  assert.strictEqual(requests.length, 1, 'زر البطاقة يجب أن يحفظ فعلاً');
  assert.strictEqual(requests[0].url, '/save-slash-command/ban');
  assert.strictEqual(card.form.nativeSubmits, 0,
    'يجب ألّا ينتقل المتصفح — الانتقال هو ما كان يستفزّ تحذير المغادرة ويُلغي الحفظ');
});

test('حارس المغادرة لا يعترض الحفظ (العطل الذي أبلغ عنه المستخدم)', async () => {
  const page = buildPage();
  run(page);
  const card = page.cards[0];
  card.form.elements[1].value = 'لف';
  page.document.fire('input', card.form.elements[1]);

  card.form.dispatchEvent({ type: 'submit', bubbles: true, preventDefault() {} });
  await settle();

  assert.strictEqual(page.window.leave(), false,
    'بعد الحفظ لا يبقى تعديل معلّق فلا يصحّ أن يعترض الحارس المغادرة');
});

test('حارس المغادرة يعمل في حالته المشروعة وحدها', () => {
  const page = buildPage();
  run(page);
  assert.strictEqual(page.window.leave(), false, 'بلا تعديلات: لا تحذير');

  page.cards[0].form.elements[1].value = 'لف';
  page.document.fire('input', page.cards[0].form.elements[1]);
  assert.strictEqual(page.window.leave(), true, 'مع تعديل غير محفوظ: يحذّر');
});

test('أثناء الحفظ تُعطَّل كل الأزرار فلا يقع ضغط مزدوج', async () => {
  const page = buildPage();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  run(page, async () => { await gate; return { ok: true, status: 200 }; });

  page.cards[0].form.elements[1].value = 'لف';
  page.document.fire('input', page.cards[0].form.elements[1]);
  page.saveButton.dispatchEvent({ type: 'click' });
  await settle();

  assert.strictEqual(page.saveButton.disabled, true, 'زر الشريط معطَّل أثناء الحفظ');
  assert.strictEqual(page.cancelButton.disabled, true, 'زر الإلغاء معطَّل أثناء الحفظ');
  assert.strictEqual(page.cards[0].submitButton.disabled, true, 'زر البطاقة معطَّل أثناء الحفظ');
  release();
  await settle();
  assert.strictEqual(page.saveButton.disabled, false, 'تعود الأزرار بعد انتهاء الحفظ');
  assert.strictEqual(page.cards[0].submitButton.disabled, false);
});

test('ضغط زر البطاقة أثناء حفظ الشريط لا يُرسل طلباً ثانياً', async () => {
  const page = buildPage();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const requests = run(page, async () => { await gate; return { ok: true, status: 200 }; });

  page.cards.forEach((c, i) => {
    c.form.elements[1].value = 'س' + i;
    page.document.fire('input', c.form.elements[1]);
  });
  page.saveButton.dispatchEvent({ type: 'click' });
  await settle();

  // محاولة تداخل أثناء انشغال الشريط
  page.cards[0].form.dispatchEvent({ type: 'submit', bubbles: true, preventDefault() {} });
  page.saveButton.dispatchEvent({ type: 'click' });
  await settle();

  assert.strictEqual(requests.length, 1, 'لا يبدأ طلب جديد ما دام هناك حفظ جارٍ');
  release();
  await settle();
  assert.strictEqual(requests.length, 2, 'ثم يكمل الشريط الأمر الثاني وحده');
});

test('تعذُّر fetch يُعيد الزر للإرسال الأصلي بلا تحذير مغادرة', async () => {
  const page = buildPage();
  run(page, () => { throw new Error('الشبكة مقطوعة'); });
  const card = page.cards[0];
  card.form.elements[1].value = 'لف';
  page.document.fire('input', card.form.elements[1]);

  card.form.dispatchEvent({ type: 'submit', bubbles: true, preventDefault() {} });
  await settle();

  assert.strictEqual(card.form.nativeSubmits, 1,
    'شبكة الأمان: يعود للسلوك القديم بدل أن يعجز المستخدم عن الحفظ');
  assert.strictEqual(page.window.leave(), false,
    'ويُرفع حارس المغادرة حتى لا يُلغي هذا الإرسال أيضاً');
});

// ===========================================================================
// مزامنة الحقول المخفية قبل الإرسال
//
// عدة محرّرات (الاختصارات، منتقي الرتب) تكتب قيمها في حقل مخفي، وتزامنه
// عبر مستمع submit. الحفظ بـ fetch لا يُطلق submit، فكانت تلك المزامنات
// تُتخطّى ويُرسل النموذج بقيم قديمة — فيضيع ما كتبه المستخدم للتوّ وتبدو
// القيمة وكأنها «رجعت فاضية» بعد الحفظ.
// ===========================================================================

test('الحفظ يُطلق submit فتعمل مزامنات المحرّرات', async () => {
  const page = buildPage();
  const requests = run(page);
  const form = page.cards[0].form;
  const hidden = form.elements[1];

  // نحاكي محرّراً يزامن حقله المخفي لحظة الإرسال فقط
  let syncs = 0;
  form.addEventListener('submit', () => { syncs += 1; hidden.value = 'مُزامَن'; });

  form.elements[2].checked = false;
  page.document.fire('change', form.elements[2]);
  page.saveButton.dispatchEvent({ type: 'click' });
  await settle();

  assert.strictEqual(syncs, 1, 'يجب أن يُطلق الحفظ حدث submit مرة واحدة');
  assert.match(requests[0].body, /aliases=%D9%85|aliases=مُزامَن/,
    'القيمة المُزامَنة هي التي تُرسل، لا القيمة القديمة');
});

test('مزامنة الإرسال لا تُدخل المعالج في تكرار لا نهائي', async () => {
  const page = buildPage();
  const requests = run(page);
  const form = page.cards[0].form;
  form.elements[1].value = 'لف';
  page.document.fire('input', form.elements[1]);

  page.saveButton.dispatchEvent({ type: 'click' });
  await settle();

  assert.strictEqual(requests.length, 1,
    'حدث المزامنة الذي نُطلقه يجب ألّا يُفسَّر كضغطة حفظ جديدة');
});

// ===========================================================================
// 🔎 التحقق بعد الحفظ: تطبيع أم ضياع؟
//
// القصة التي أبلغ عنها المستخدم: أضاف الاختصار «come» إلى بطاقة «الاستدعاء»،
// فظهر «أرسلنا «come» لكن الخادم أعاد فارغ — الكتابة في قاعدة البيانات لم
// تثبت». والكتابة كانت ناجحة تماماً؛ الخادم يُسقط الاختصار المطابق لاسم
// الأمر نفسه لأنه لا معنى له (الأمر يعمل باسمه أصلاً).
//
// هذه الاختبارات تشغّل سكربت الصفحة الفعلي فوق DOM مصغّر وتقفل السلوكين:
//   • تطبيع مشروع  → نجاح، مع بيان ما طبّعه الخادم.
//   • قيمة عادت كما كانت قبل الحفظ → وحدها تُعرض كضياع، مع حكم قاعدة البيانات.
// ===========================================================================

/** صفحة بحقل اختصارات داخل محرّر باسم أمر معلوم + قراءة بعد الحفظ */
function buildVerificationPage(options = {}) {
  const page = buildPage(options);
  page.userFields = {};
  page.fresh = {
    querySelector(selector) {
      if (selector === '.save-bar-build') return null;
      const action = (selector.match(/^form\[action="([^"]+)"\]$/) || [])[1];
      if (!action) return null;
      return { elements: page.userFields[action] || {} };
    }
  };
  return page;
}

/** يضبط ما سيعيده الخادم بعد الحفظ لكل مسار */
function respondWith(page, valuesByAction) {
  page.userFields = valuesByAction;
  page.calls = [];
  return async (url, options) => {
    page.calls.push(url);
    if (url === '/save-health') {
      return { ok: true, json: async () => ({ botSettingsValueType: 'jsonb', buildId: 'x', instanceId: 'y' }) };
    }
    if (options && options.method === 'POST') return { ok: true, status: 200 };
    return { ok: true, status: 200, text: async () => '<html></html>' };
  };
}

const markDirty = (page, card, value) => {
  card.form.elements[1].value = value;
  page.document.fire('input', card.form.elements[1]);
};

test('اختصار مثل $come يُحفظ فعلاً الآن — الرفض الوحيد: المكرر أو الأطول من 32', async () => {
  const page = buildVerificationPage({ aliasCanonical: 'come' });
  const card = page.cards[0];
  card.form.attrs.action = '/save-command-come';
  const requests = run(page, respondWith(page, {
    '/save-command-come': { aliases: { value: '["$come"]', checked: false }, enabled: { value: 'on', checked: true } }
  }));

  // كان $come يُسقطه الخادم لأنه «اسم الأمر نفسه». بقرار المالك صار مقبولاً،
  // فنثبت هنا أن الحفظ يعرض نجاحاً وأن القيمة عادت كما كُتبت.
  markDirty(page, card, '$come');
  page.saveButton.dispatchEvent({ type: 'click' });
  await settle();

  assert.ok(!page.bar.classList.contains('is-error'), '$come صار اختصاراً مقبولاً');
  assert.match(page.text.textContent, /تم حفظ/, 'يجب أن يُعلن الحفظ نجاحه');
  assert.ok(requests.some(r => r.url.startsWith('/save-command-come')),
    'ويبقى الطلب قد أُرسل فعلاً');
});

test('قيمة طبّعها الخادم تُعرض تطبيعاً مع بيانه لا كفشل', async () => {
  const page = buildVerificationPage({ aliasCanonical: 'ban' });
  const card = page.cards[0];
  const requests = run(page, respondWith(page, {
    '/save-slash-command/ban': { aliases: { value: 'باند', checked: false }, enabled: { value: 'on', checked: true } }
  }));

  markDirty(page, card, 'باند,باند-مكرر');   // الخادم يزيل المكرر ويُبقي الأول
  page.saveButton.dispatchEvent({ type: 'click' });
  await settle();

  assert.ok(!page.bar.classList.contains('is-error'), 'التطبيع ليس فشلاً');
  assert.match(page.text.textContent, /وطبّع الخادم/, 'يجب أن يبيّن ما طبّعه الخادم');
  assert.ok(!page.calls.includes('/save-health'),
    'لا داعي لسؤال قاعدة البيانات ما دام الحفظ ظاهر الأثر');
});

test('قيمة عادت كما كانت قبل الحفظ: وحدها تُعرض ضياعاً مع حكم قاعدة البيانات', async () => {
  const page = buildVerificationPage({ aliasCanonical: 'ban' });
  const card = page.cards[0];
  const requests = run(page, respondWith(page, {
    '/save-slash-command/ban': { aliases: { value: '', checked: false }, enabled: { value: 'on', checked: true } }
  }));

  markDirty(page, card, 'لف');               // قيمة سليمة، ومع ذلك عاد الحقل فارغاً كما كان
  page.saveButton.dispatchEvent({ type: 'click' });
  await settle();

  assert.ok(page.bar.classList.contains('is-error'), 'بلا أثر للكتابة = فشل حقيقي');
  assert.match(page.text.textContent, /بلا أثر للكتابة/);
  assert.match(page.text.textContent, /سليمة \(jsonb\)/,
    'ويُقال للمالك صراحةً إن كانت قاعدة البيانات سليمة أم لا');
  assert.ok(page.calls.includes('/save-health'), 'يُسأل الفحص عند الشك فقط');
});
