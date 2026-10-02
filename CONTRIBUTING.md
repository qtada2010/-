# 🛠️ دليل التعديل على البوت

هذا الملف يشرح كيف تعدّل على المشروع **دون أن تكسر شيئاً يعمل**.

---

## ⚠️ القاعدة الذهبية

> كل أمر يعمل اليوم يجب أن يبقى يعمل غداً.

قبل أي تعديل وبعده:

```bash
npm run verify
```

وإذا لمست أي صفحة في لوحة التحكم، أضف إليها:

```bash
npm run snapshot:before    # قبل التعديل
# ... عدّل ...
npm run snapshot:after
npm run snapshot:diff      # يجب ألا يُظهر إلا ما قصدته
```

---

## ➕ كيف أضيف أمر سلاش جديد؟

الأمر الواحد مُسجَّل في **أربعة أماكن**. نسيان أحدها يسبب فشل الاختبارات
(وهذا مقصود — الاختبار يمسك الخطأ قبل المستخدم).

### 1) عرّف الأمر — `slashCommands.js`

أضف كائن الأمر إلى `commandData`:

```js
{
  name: 'mycommand',
  description: 'وصف قصير يظهر للمستخدم في ديسكورد',
  type: 1,
  options: [
    { name: 'member', description: 'العضو المستهدف', type: 6, required: true }
  ]
}
```

ثم أضف منطق التنفيذ في معالج الأوامر بنفس الملف.

### 2) صنّف الأمر — `commandCategories.js`

أضف مدخلاً في `SLASH_COMMAND_CATEGORIES` **في موضعه الأبجدي**:

```js
  move: COMMAND_CATEGORIES.admin,
  mycommand: COMMAND_CATEGORIES.admin,   // ← هنا بالضبط، بين move و myinfo
  myinfo: COMMAND_CATEGORIES.xp,
```

> ❗ إن وضعته في غير موضعه الأبجدي سيفشل اختبار
> «ملف commandCategories مكتوب بترتيب أبجدي».

الأقسام المتاحة: `tickets` · `admin` · `senior` · `owner` · `xp` · `services` · `other`.
لأكثر من قسم: `Object.freeze(['admin', 'xp'])`.

### 3) أعد توليد التوثيق

```bash
node generateCommandDocs.js
```

### 4) تحقق

```bash
npm run verify
```

بطاقة الأمر تظهر تلقائياً في صفحة `/commands` في موضعها الأبجدي الصحيح —
لا تحتاج لمس `dashboard.js` إطلاقاً.

---

## 🛡️ كيف أضيف بطاقة صلاحيات جديدة للوحة؟

في `dashboard.js` داخل مسار `/commands`، ابحث عن `permissionCardList`
وأضف عنصراً للمصفوفة:

```js
{
  title: 'عنوان البطاقة كما يظهر للمستخدم',
  html: renderCommandPermissionCard({
    slug: 'my-feature',
    title: 'عنوان البطاقة كما يظهر للمستخدم',
    command: '!أمري  ·  /mycommand',
    description: 'شرح قصير لما تتحكم به هذه البطاقة.',
    action: '/save-command-permissions/my-feature',
    fields: [{ name: 'myRoleId', label: 'الرولات المسموح لها', value: commandPermissions.my_role_id }]
  })
}
```

**لا تهتم بمكان الإضافة في المصفوفة** — `sortByName` يضعها في موضعها
الأبجدي عند العرض تلقائياً.

ثم أضف مسار الحفظ `/save-command-permissions/my-feature` وصنّفه في
`FORM_ACTION_CATEGORIES` داخل `commandCategories.js` (في موضعه الأبجدي).

---

## 🔤 لماذا كل شيء مرتّب أبجدياً؟

لأن الترتيب العشوائي يجعل إيجاد أمر بين ٦٣ بطاقة مهمة بحث بصري مرهقة.
الترتيب الأبجدي يعني: **تعرف أين تنظر قبل أن تنظر**.

كل الترتيب يمرّ عبر ملف واحد: `commandSorting.js`. لا تكتب منطق ترتيب
جديداً في أي مكان آخر — استورد `sortByName` منه.

```js
const { sortByName } = require('./commandSorting');

// ⚠️ sortByName لا تعدّل المصفوفة الأصلية — وهذا مقصود.
// مصفوفات مثل commandData مشتركة مع تسجيل أوامر السلاش في ديسكورد،
// وترتيبها في مكانها قد يغيّر سلوكاً آخر.
const sorted = sortByName(items, item => item.name);
```

---

## 🔬 أدوات التحقق — ماذا يفعل كل منها؟

| الأداة | تجيب على سؤال |
|---|---|
| `npm run check` | هل كل ملف صالح نحوياً؟ |
| `npm test` | هل منطق التوجيه والتصنيف والترتيب سليم؟ |
| `npm run snapshot:*` | هل تغيّر شيء في صفحات اللوحة لم أقصده؟ |

### كيف تعمل اللقطات؟

`renderSnapshots.js` يشغّل لوحة التحكم بـ:
- **قاعدة بيانات وهمية** تُرجع صفوفاً ثابتة (لا اتصال حقيقي)
- **عميل ديسكورد وهمي** برتب وقنوات ثابتة (لا اتصال بالإنترنت)

فتخرج صفحات HTML قابلة للتكرار بالضبط. ثم `compareSnapshots.js` يقارن
لقطتين ويتحقق من أربعة أشياء:

1. لم تضع أي بطاقة أمر ولم تظهر بطاقة غريبة
2. محتوى كل بطاقة متطابق حرفياً
3. هيكل الصفحة خارج البطاقات لم يتغيّر
4. كل مسارات الحفظ (`form action`) ما زالت موجودة

إن كان الفرق الوحيد هو الترتيب، تطبع:
`✅ لا شيء تغيّر سوى الترتيب`.

---

## 🚫 أشياء لا تفعلها

| ❌ لا تفعل | ✅ افعل بدلاً منها |
|---|---|
| `array.sort()` مباشرة على `commandData` | `sortByName(commandData, c => c.name)` |
| بناء SQL بتسلسل نصوص | استخدم معاملات `$1, $2` |
| طباعة قيمة في HTML بلا تنقية | مرّرها على `escapeHtml()` |
| كتابة كلمة مرور أو توكن في الكود | ضعها في `.env` |
| تعديل `COMMANDS.md` يدوياً | `node generateCommandDocs.js` |
| حذف أمر لأنه «يبدو غير مستخدم» | تأكد أولاً — قد يكون له اختصار بريفكس |

---

## 🗄️ ملاحظة عن قاعدة البيانات

الجداول تُنشأ وتُحدَّث تلقائياً في `database.js` عند الإقلاع عبر
`CREATE TABLE IF NOT EXISTS`. عند إضافة عمود جديد، أضفه هناك بصيغة
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` حتى تعمل القواعد القائمة
دون تدخل يدوي.
