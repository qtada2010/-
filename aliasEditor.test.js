'use strict';

// ============================================================================
// 🖱️ محرّر الاختصارات في اللوحة — اختبار سلوكي حقيقي
//
// يُستخرج سكربت المحرّر من صفحة /commands المُصيَّرة ويُشغَّل داخل DOM مصغّر
// (بلا jsdom)، ثم نضغط «Add» فعلاً ونتحقّق مما يحدث:
//
//   1) اختصار مستخدم في أمر آخر → يُرفض برسالة تذكر اسم صاحبه.
//   2) اختصار أطول من 32 حرفاً → يُرفض.
//   3) أي شيء آخر يُقبل ويُخزَّن JSON في الحقل المخفي (فالفاصلة صارت مسموحة).
//   4) حذف الاختصار يحرّره للأوامر الأخرى.
//
// سبب وجوده: قاعدة «الرفض في حالتين فقط» قرار مالك، ويجب أن تُختبر كما يراها
// هو على الشاشة — لا بفحص نص السكربت وحده.
// ============================================================================

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

// اللقطة تُولَّد محلياً (npm run snapshot:after) ولا تُرفع للمستودع.
//
// ⚠️ كانت هذه حزمة الاختبارات كلها تفشل على أي نسخة جديدة من المستودع لأن
// المجلد غير موجود فيها — أي أن `npm test` (و `npm run verify` الذي يوثّقه
// README كشبكة الأمان) كانا يفشلان من أول تشغيل بلا أي علاقة بالكود.
//
// الحل: إن وُجدت اللقطة نقرؤها، وإلا نُولّدها تلقائياً في مجلد مؤقت. لا يتغيّر
// أي سلوك لمن يولّد لقطاته بنفسه، ويصبح `npm test` عاملاً وحده.
function resolveSnapshotHtml() {
  const committed = path.join(__dirname, '.snapshots', 'after', 'commands.html');
  if (fs.existsSync(committed)) return fs.readFileSync(committed, 'utf8');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'on-snapshot-'));
  try {
    execFileSync(process.execPath, [path.join(__dirname, 'renderSnapshots.js'), tmpDir], { stdio: 'ignore' });
  } catch (error) {
    throw new Error(`تعذّر توليد لقطة صفحة /commands تلقائياً: ${error.message}`);
  }
  const generated = path.join(tmpDir, 'commands.html');
  if (!fs.existsSync(generated)) throw new Error('لم تُنتَج لقطة صفحة /commands');
  return fs.readFileSync(generated, 'utf8');
}

const pageHtml = resolveSnapshotHtml();

// ---------------------------------------------------------------------------
// DOM مصغّر: يكفي ما يستعمله سكربت المحرّر فقط
// ---------------------------------------------------------------------------
class El {
  constructor(tag, attrs = {}) {
    this.tagName = String(tag).toUpperCase();
    this.attrs = { ...attrs };
    this.children = [];
    this.listeners = {};
    this.parent = null;
    this.value = '';
    this.textContent = '';
    this.hidden = false;
    this._className = attrs.class || '';
    const store = {};
    this.dataset = new Proxy(store, {
      set: (target, key, value) => {
        target[key] = String(value);
        this.attrs['data-' + String(key).replace(/[A-Z]/g, m => '-' + m.toLowerCase())] = String(value);
        return true;
      },
      get: (target, key) => target[key] !== undefined
        ? target[key]
        : this.attrs['data-' + String(key).replace(/[A-Z]/g, m => '-' + m.toLowerCase())]
    });
  }
  get className() { return this._className; }
  set className(value) { this._className = String(value); }
  append(...nodes) { nodes.forEach(node => { node.parent = this; this.children.push(node); }); }
  replaceChildren() { this.children = []; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  dispatchEvent(event) { (this.listeners[event.type] || []).forEach(fn => fn({ ...event, target: event.target || this })); }
  dispatch(type, target) { this.dispatchEvent({ type, target: target || this, preventDefault() {}, bubbles: true }); }
  get descendants() { return this.children.flatMap(child => [child, ...child.descendants]); }
  matchesSimple(selector) {
    if (selector.startsWith('.')) return this.className.split(/\s+/).includes(selector.slice(1));
    const attr = selector.match(/^([a-z]*)\[([a-z-]+)(?:="([^"]*)")?\]$/i);
    if (attr) {
      const [, tag, name, value] = attr;
      if (tag && this.tagName !== tag.toUpperCase()) return false;
      if (!Object.prototype.hasOwnProperty.call(this.attrs, name)) return false;
      return value === undefined || this.attrs[name] === value;
    }
    return this.tagName === selector.toUpperCase();
  }
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
  querySelectorAll(selector) { return this.descendants.filter(el => el.matches(selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) {
    let node = this;
    while (node) { if (node.matches && node.matches(selector)) return node; node = node.parent; }
    return null;
  }
}

function buildEditor(cardName, aliases) {
  const root = new El('div');
  const card = new El('section', { class: 'card cmd-card' });
  const name = new El('span', { class: 'cmd-name' });
  name.textContent = cardName;
  card.append(name);
  const editor = new El('div', { 'data-alias-editor': '', 'data-canonical': 'x' });
  const input = new El('input', { 'data-alias-input': '' });
  const chips = new El('div', { 'data-alias-chips': '' });
  // الرقاقات تُصيَّر على الخادم في الصفحة الحقيقية — نحاكيها هنا
  aliases.forEach(alias => {
    const chip = new El('span', { class: 'alias-chip' });
    const label = new El('span');
    label.textContent = alias;
    const remove = new El('button', { 'data-remove-alias': alias });
    chip.append(label, remove);
    chips.append(chip);
  });
  const values = new El('input', { 'data-alias-values': '' });
  values.value = JSON.stringify(aliases);
  const error = new El('p', { 'data-alias-error': '' });
  const add = new El('button', { 'data-alias-add': '' });
  const form = new El('form', { action: '/save' });
  editor.append(input, chips, values, error, add);
  form.append(editor);
  card.append(form);
  root.append(card);
  return { root, editor, input, chips, values, error, add, card };
}

// ---------------------------------------------------------------------------
// استخراج سكربت المحرّر من الصفحة الحقيقية (نفس ما يصل للمتصفح)
// ---------------------------------------------------------------------------
function extractEditorScript() {
  const scripts = [...pageHtml.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  const host = scripts.find(script => script.includes('data-alias-editor'));
  assert.ok(host, 'لم يُعثر على سكربت محرّر الاختصارات في الصفحة المُصيَّرة');
  const start = host.indexOf('function parseAliasValues(raw) {');
  assert.ok(start >= 0, 'لم يُعثر على بداية قواعد الاختصارات');
  const marker = "editor.closest('form').addEventListener('submit', flushPendingAlias);";
  const at = host.indexOf(marker, start);
  assert.ok(at >= 0, 'لم يُعثر على نهاية محرّر الاختصارات');
  const close = host.indexOf('});', at);
  assert.ok(close >= 0, 'لم يُعثر على إغلاق حلقة المحرّرات');
  return host.slice(start, close + 3);
}

function mount(editors) {
  const body = new El('body');
  editors.forEach(entry => body.append(entry.root));
  const document = {
    body,
    querySelector: selector => body.querySelector(selector),
    querySelectorAll: selector => body.querySelectorAll(selector),
    createElement: tag => new El(tag)
  };
  const sandbox = { document, Event: class { constructor(type) { this.type = type; } }, console };
  vm.createContext(sandbox);
  new vm.Script(extractEditorScript()).runInContext(sandbox);
  return document;
}

const typeAndAdd = (editor, value) => {
  editor.input.value = value;
  editor.add.dispatch('click');
};

test('اختصار مستخدم في أمر آخر: يُرفض برسالة تذكر اسم صاحبه', () => {
  const ban = buildEditor('ban', ['لف', '#حظر']);
  const kick = buildEditor('kick', []);
  mount([ban, kick]);

  typeAndAdd(kick, '#حظر');

  assert.match(kick.error.textContent, /مستخدم في/, 'يجب أن يُرفض التكرار');
  assert.match(kick.error.textContent, /«ban»/, 'ويُذكر اسم الأمر الذي يستخدمه داخل علامات واضحة');
  assert.deepStrictEqual(JSON.parse(kick.values.value), [], 'ولم يُضف شيء');
});

test('اسم الأمر الرسمي محسوب مالكاً: اختصار kick مرفوض باسمه', () => {
  const ban = buildEditor('ban', []);
  mount([ban]);

  typeAndAdd(ban, 'kick');

  assert.match(ban.error.textContent, /مستخدم في «\/kick» سابقاً/,
    'اسم الأمر الرسمي مستخدم في أمره، فيُذكر اسمه في الرسالة');
});

test('الاختصار المطابق لاسم الأمر نفسه مقبول الآن ($help للأمر help)', () => {
  const help = buildEditor('help', []);
  mount([help]);

  typeAndAdd(help, '$help');

  assert.strictEqual(help.error.textContent, '', 'لا رفض: الحالتان الوحيدتان هما التكرار والطول');
  assert.deepStrictEqual(JSON.parse(help.values.value), ['$help'], 'وخُزِّن فعلاً');
});

test('الرموز والفاصلة والمسافة تُقبل وتُخزَّن JSON', () => {
  const ban = buildEditor('ban', []);
  mount([ban]);

  ['&*&@*', 'a,b', 'حظر عام', '#1'].forEach(alias => typeAndAdd(ban, alias));

  assert.strictEqual(ban.error.textContent, '');
  assert.deepStrictEqual(JSON.parse(ban.values.value), ['&*&@*', 'a,b', 'حظر عام', '#1']);
});

test('الأطول من 32 حرفاً يُرفض وحده', () => {
  const ban = buildEditor('ban', []);
  mount([ban]);

  typeAndAdd(ban, 'x'.repeat(33));

  assert.match(ban.error.textContent, /32/, 'رسالة الطول');
  assert.deepStrictEqual(JSON.parse(ban.values.value), []);
});

test('حذف الاختصار يحرّره للأوامر الأخرى', () => {
  const ban = buildEditor('ban', ['لف']);
  const kick = buildEditor('kick', []);
  const document = mount([ban, kick]);

  typeAndAdd(kick, 'لف');
  assert.match(kick.error.textContent, /مستخدم في/, 'مرفوض ما دام مستخدماً');

  // نحذفه من أمر الحظر (نفس ما يفعله زر × في الرقاقة)
  const removeButton = document.querySelector('[data-remove-alias]');
  assert.ok(removeButton, 'رقاقة الحذف موجودة');
  ban.chips.dispatch('click', removeButton);

  typeAndAdd(kick, 'لف');
  assert.strictEqual(kick.error.textContent, '', 'صار متاحاً بعد الحذف');
  assert.deepStrictEqual(JSON.parse(kick.values.value), ['لف']);
});
