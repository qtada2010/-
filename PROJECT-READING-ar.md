# 📖 تقرير قراءة المشروع — ON-V2

> قُرئ المشروع كما تطلب `README.md` و `CONTRIBUTING.md`: أولاً شبكة الأمان، ثم نقطة البداية
> `index.js`، ثم خريطة الملفات والأنظمة. كل نتيجة مكتوبة أدناه **شُغّلت فعلياً** في هذه الجلسة
> ولم تُنقل من التوثيق.

---

## 0) الملخص في ستة أسطر

بوت ديسكورد عربي متكامل (`Node.js` + `discord.js v14` + `Express` + `PostgreSQL`) يُدار بالكامل من
**لوحة تحكم ويب** بلا لمس الكود. كل أمر له نسختان: سلاش `/` وبريفكس `!`. فيه **52 أمراً** موثَّقة في
`COMMANDS.md` **مولَّد آلياً** من الكود. الأنظمة مقسّمة إلى ملفات مستقلة تُركَّب كلها في `index.js`
عبر إدخال التبعيات (`pool`, `client`, `app`). الحالة مشتركة ودائمة في PostgreSQL (**27 جدولاً** تُنشأ
وتُحدَّث تلقائياً عند الإقلاع). شبكة الأمان ثلاثية: فحص نحو + اختبارات + لقطات HTML لصفحات اللوحة.

---

## 1) حالة المستودع والتحقق — النتائج الفعلية

| الفحص | الأمر | النتيجة |
|---|---|---|
| الفرع الحالي | `git status` | `arena/01a0fc52-on-v2` عند `7b29430` («ش»)، شجرة نظيفة |
| تثبيت الاعتماديات | `npm install` | ✅ نجح — `discord.js`, `discord-html-transcripts`, `express`, `pg` |
| فحص النحو | `npm run check` | ✅ **56 ملفاً** كلها صالحة نحوياً |
| الاختبارات | `npm test` | ✅ **152 اختباراً / 121 مجموعة — 0 فشل** (≈5 ثوانٍ) |
| التحقق الكامل | `npm run verify` | ✅ نجح |
| لقطة خط الأساس | `npm run snapshot:before` | ✅ **12 صفحة** HTML (`.snapshots/before`) |
| أداة المقارنة | `npm run snapshot:diff` | ✅ «لا شيء تغيّر سوى الترتيب» — الأداة تعمل |
| توثيق الأوامر | `node generateCommandDocs.js` | ✅ الملف المولَّد **مطابق حرفياً** لـ `COMMANDS.md` (غير متقادم) |
| عدد الأوامر الفعلي | `require('./slashCommands').commandData.length` | **52 أمراً** — مطابق لِما يقوله `README` |
| تدقيق الحزم | `npm audit --omit=dev` | ⚠️ تحذيران (1 متوسط، 1 عالٍ) عبر `undici` داخل `discord-html-transcripts` |

### ما يعنيه ذلك عملياً

```bash
# قبل أي تعديل
npm run snapshot:before     # ✅ محفوظة الآن في .snapshots/before
# ... التعديل ...
npm run snapshot:after && npm run snapshot:diff
npm run verify
```

خط الأساس جاهز ومحفوظ، فأي تعديل قادم يمكن قياس أثره بالضبط.

---

## 2) نقطة البداية: كيف يُجمَّع البوت (`index.js`)

`index.js` هو المكان الوحيد الذي يعرف ترتيب التحميل، والترتيب مقصود:

| # | السطر | لماذا هذا الترتيب |
|---|---|---|
| 0 | `process.on('unhandledRejection' / 'uncaughtException')` | شبكة أمان: خطأ في مكان واحد لا يوقف العملية كلها |
| 1 | `require('./database')` | الـ `pool` + إنشاء/تحديث الجداول يبدأ فوراً |
| 2 | `require('./discordClient')` | العميل `client` + `PREFIX = '!'` و `ADMIN_PREFIX = '$'` |
| 3 | `require('./state')` | حالة مشتركة (روم لوق المالك) |
| 4 | `require('./ticketHelpers')(client, pool, state)` | دوال التذاكر: `sendLogError`, `getTicketInfo`, `saveTranscript`, `createHelpEmbed`, `handleTicketCreation`… |
| 4.1 | `ticketClaimState(pool)` | استلام التذاكر مخزَّن بقاعدة البيانات لا بموضوع القناة |
| 5 | `ready(client, sendLogError)` + `slashCommands(client, pool)` | تسجيل أوامر السلاش لدى ديسكورد + تنفيذها |
| 6 | `dashboard(pool, client)` | خادم Express بكل صفحات اللوحة |
| 7 | `messageCreate(...)` | أوامر البريفكس `!` |
| — | `system(client, '!', pool)` | **قبل** `interactionCreate` لأن `/help` يستدعي `buildFullHelpMenu` منه |
| 8 | `interactionCreate(client, pool, helpers, claimState, systemCommands)` | الأزرار والقوائم والنماذج |
| 9 | `xp` · `claimCommands` · `clans` · `autoRoles` · `welcome` | أنظمة مستقلة تضيف جداولها وصفحاتها بنفسها على `app` الممرَّر |
| 10 | `client.login(process.env.DISCORD_TOKEN)` | الاتصال بديسكورد آخر خطوة |

**القاعدة المعمارية المستخلَصة:** كل نظام «إضافة» جديد لا يلمس ملفاً قديماً — يأخذ
`(client, pool, app)` وينشئ جدوله وصفحاته ومعالجه بنفسه. هذا ما يجعل التوسّع آمناً.

---

## 3) خريطة الملفات حسب الوظيفة

| 🔌 البنية التحتية | الوظيفة |
|---|---|
| `index.js` | نقطة التشغيل — تجميع الأنظمة بالترتيب |
| `database.js` | اتصال PostgreSQL + كل جداول المشروع (27) وترحيلات `ALTER TABLE … IF NOT EXISTS` |
| `discordClient.js` | إنشاء العميل + البريفكسات |
| `state.js` | حالة مشتركة بسيطة |
| `ready.js` | تسجيل أوامر السلاش عند الإقلاع |

| 🎯 توجيه الأوامر | الوظيفة |
|---|---|
| `slashCommands.js` (1516 سطراً) | **مصدر الحقيقة**: `commandData` (52 أمراً) + معالجاتها |
| `slashPrefix.js` | الجسر الذي يمنح **كل** أمر سلاش نسخة بريفكس `!` |
| `messageCreate.js` | معالجة البريفكس + أوامر `$` |
| `interactionCreate.js` | أزرار وقوائم ونماذج التذاكر والتقديم |
| `systemSlashBridge.js` | جسر يفوّض أوامر السلاش إلى منطق `system.js` بلا تكرار (`help, channel, ticket, claimstats, xpmanage, myinfo, clan…`) |
| `commandConfig.js` / `slashCommandConfig.js` | قراءة/كتابة إعدادات الأوامر (الضريبة، الاستدعاء، say، warn-dm…) من قاعدة البيانات |
| `commandCategories.js` | تصنيف كل أمر — **مرتّب أبجدياً، ويوجد اختبار يحرس ذلك** |
| `commandSorting.js` | المصدر الوحيد للترتيب الأبجدي (يفهم العربية والإنجليزية والأرقام) |
| `customCommands.js` | بناء حمولات الضريبة/الاستدعاء/say |
| `commandUsage.js` | إيمبد الاستخدام الموحّد + الاختصارات |
| `duration.js` | تحويل الصيغ الزمنية (`10m`, `ساعة`…) |

| 🧩 الأنظمة | الوظيفة |
|---|---|
| `ticketHelpers.js` · `ticketClaimState.js` · `claimCommands.js` | التذاكر والاستلام والنسخ |
| `clans.js` (1677 سطراً) | الكلانات، الأعضاء، لوحات التقديم |
| `xp.js` · `xpLeaderboard.js` | الإكسبي والمستويات والتوب والأرشفة |
| `system.js` (1252 سطراً) | أوامر النظام والإدارة وقائمة `$help` الشاملة |
| `welcome.js` · `autoRoles.js` | الترحيب والرتب التلقائية |
| `warnDirectMessage.js` | رسالة التحذير الخاصة |

| 🖥️ لوحة التحكم | الوظيفة |
|---|---|
| `dashboard.js` (4027 سطراً) | الخادم و**28 مساراً** + `BUILD_ID` و `INSTANCE_ID` لكشف تعدّد النسخ |
| `dashboardAuth.js` | HMAC-SHA256 + مقارنة ثابتة الزمن + حد 10 محاولات/15 دقيقة |
| `webSafety.js` | التقاط أخطاء async + CSRF + تنقية المدخلات |
| `htmlEscape.js` · `siteTheme.js` · `dashboardUrl.js` | منع XSS · الهوية البصرية · الرابط العام |
| `xp.js` · `welcome.js` · `autoRoles.js` | تضيف **13 مساراً** إضافياً على نفس `app` |

| 🔬 أدوات التطوير (لا تعمل مع البوت) | الوظيفة |
|---|---|
| `checkSyntax.js` | فحص نحو كل الملفات |
| `renderSnapshots.js` + `mockEnvironment.js` | التقاط صفحات اللوحة بـ pool و client **وهميين** (بلا إنترنت وبلا قاعدة بيانات) |
| `compareSnapshots.js` | مقارنة لقطتين + التحقق من البطاقات ومسارات الحفظ |
| `generateCommandDocs.js` | توليد `COMMANDS.md` من `slashCommands.js` + `commandCategories.js` |
| `previewDashboard.js` · `recolorTheme.js` · `refineTheme.js` · `diagnoseSaving.js` | معاينة وتشخيص |

---

## 4) كيف يُوجَّه الأمر الواحد (المسار كاملاً)

```
المستخدم
 ├─ /command ─────────► slashCommands.js (commandData + execute)
 │                        └─ إن كان الاسم في SYSTEM_SLASH_COMMANDS
 │                            └─ systemSlashBridge ──► system.js / xp.js / clans.js / claimCommands.js
 └─ !command ────────► messageCreate.js ($ / !)
                          └─ slashPrefix.js: يبني تفاعلاً وهمياً ويعيد استخدام نفس معالج السلاش
```

**الفائدة العملية:** منطق الأمر مكتوب **مرة واحدة**، والنسختان (سلاش وبريفكس) متطابقتان
تلقائياً — لذلك لا تجد اختلاف سلوك بين `/tax` و `!tax`.

---

## 5) سير العمل الإلزامي قبل أي تعديل (من `CONTRIBUTING.md`)

1. **قبل وبعد أي تعديل:** `npm run verify`.
2. **إن لمست صفحة لوحة:** `snapshot:before` → التعديل → `snapshot:after` → `snapshot:diff`.
3. **أمر جديد = أربعة أماكن:**
   `slashCommands.js` (التعريف + المنطق) → `commandCategories.js` (**في موضعه الأبجدي وإلا فشل اختبار**)
   → `node generateCommandDocs.js` → `npm run verify`.
4. **بطاقة صلاحيات جديدة** = عنصر في `permissionCardList` داخل مسار `/commands` + مسار حفظ
   `/save-command-permissions/...` + تصنيفه في `FORM_ACTION_CATEGORIES`.
5. **الممنوعات:** `array.sort()` على `commandData` · بناء SQL بتسلسل نصوص · طباعة قيمة بلا
   `escapeHtml` · كتابة سر في الكود · تعديل `COMMANDS.md` يدوياً.
6. **الترتيب:** كل الترتيب يمرّ عبر `sortByName` من `commandSorting.js` (لا تعدّل المصفوفة الأصلية).

---

## 6) ملاحظات ووجدتها أثناء القراءة

### ⚠️ 1) `.gitignore` و `.gitattributes` **غير موجودين فعلياً** — وهذه أهم ملاحظة عملية

`README.md` يقول: «لا ترفع ملف `.env` إلى GitHub أبداً. هو مستثنى في `.gitignore`»، و`CONTRIBUTING.md`
و`COMPARISON` يشيران لنفس الشيء. لكن المستودع **لا يحتوي أي `.gitignore`**، و`git status` يُظهر
`node_modules/` و `.snapshots/` كملفات غير متتبَّعة (أي كانت ستُرفع مع أول `git add .`).

السبب واضح: الملفان موجودان باسمين غريبين لأنهما نُزِّلا من GitHub ولم يُعاد تسميتهما:

| الملف | محتواه الحقيقي |
|---|---|
| `download` | محتوى `.gitattributes` (توحيد نهايات الأسطر LF) |
| `download (1)` | محتوى `.gitignore` (`node_modules/`, `.env`, `.snapshots/`, `*.log`…) |

**الأثر:** خطر أمني حقيقي — توكن البوت وكلمة مرور اللوحة ورابط قاعدة البيانات بلا أي حماية من الرفع.
الإصلاح بسيط (ثانيتان): إنشاء `.gitignore` و `.gitattributes` بالمحتوى الموجود، وحذف الملفين الغريبين.

### 🔎 2) ملاحظات أصغر

- `checkSyntax.js` يتحدث عن «ملف `.js` في جذر المشروع **ومجلد tools**» — لا يوجد مجلد `tools` في
  المستودع. أثر التعليق صفري (الفحص يقتصر على العمق 0–1)، لكنه يشوّش القارئ.
- `npm audit` يُبلّغ عن ثغرتين عبر `undici` داخل `discord-html-transcripts` (نسخ التذاكر HTML).
  الإصلاح متاح بـ `npm audit fix`، ويستحق تجربة مع إعادة تشغيل `npm run verify` بعده.
- توزيع الأوامر في `COMMANDS.md`: `admin 30` · `services 10` · `xp 8` · `other 3` · `tickets 2` ·
  `owner 2` — المجموع 55 لأن 3 أوامر (`reset`, `setlevel`, `setxp`) في قسمين، والمجموع الفعلي 52. ✔️
- ملفات التوثيق تشير إلى «بطاقة أمر» و«٥٢ أمراً» بدقة، والكود مطابق — لا انحراف توثيقي عدا ما ذُكر.
- `dashboard.js` فيه 28 مساراً + 13 مساراً من `xp/welcome/autoRoles` = **41 مساراً** في نفس تطبيق Express.

### ✅ 3) ما لم أفعله (حدود القراءة)

- لم أشغّل البوت فعلياً (`node index.js` يحتاج `DISCORD_TOKEN` و `DATABASE_URL` حقيقيين) — وهذا
  مقصود، فلا توكن ولا قاعدة بيانات هنا.
- لم أقرأ الـ 17,584 سطراً سطراً سطراً؛ قرأت البنية، وكل الرؤوس التوثيقية، وكل المسارات، ومصادر
  الحقيقة (`commandData`, `commandCategories`, `commandSorting`). التفاصيل الداخلية لكل معالج
  تُقرأ عند الحاجة إليها في مهمة محددة.
- لم أعدّل أي ملف في المشروع — التقرير وحده إضافة جديدة (`PROJECT-READING-ar.md`)، وخط الأساس
  محفوظ في `.snapshots/before`.

---

## 7) جاهز للخطوة التالية

الأرضية مستوية: القاعدة نظيفة، الاختبارات خضراء، لقطة قبل التعديل محفوظة، والتوثيق غير متقادم.
أخبرني بالمطلوب وأنفّذه بنفس القواعد: تعديل مُوجَّه + `npm run verify` + `snapshot:diff` + دليل على
النتيجة. اقتراحات قريبة من واقع المشروع:

1. **إصلاح `.gitignore` / `.gitattributes`** (الملاحظة الأهم أعلاه) — إصلاح فوري بلا أي مخاطرة وظيفية.
2. **إضافة أمر جديد** (سلاش + بريفكس + بطاقة لوحة + توثيق) بالطريقة الأربعية الرسمية.
3. **معالجة تحذيرَي `npm audit`** مع التحقق من عدم كسر نسخ التذاكر.
4. **صفحة/بطاقة جديدة في لوحة التحكم** مع لقطة قبل/بعد تُثبت أن شيئاً آخر لم يتغيّر.
