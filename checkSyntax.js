#!/usr/bin/env node
'use strict';
// ==========================================================================
// ✅ checkSyntax.js — فحص سريع: هل كل ملفات المشروع صالحة نحوياً؟
//
// يمر على كل ملفات .js في جذر المشروع ومجلد tools ويتأكد أن Node يستطيع
// تحليلها. يكشف فوراً أي قوس ناقص أو علامة اقتباس غير مغلقة بعد أي تعديل،
// قبل أن تكتشفها عند تشغيل البوت.
//
// الاستخدام:  npm run check
// ==========================================================================

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = __dirname;
const SKIP_DIRS = new Set(['node_modules', '.git', '.snapshots']);

function collect(dir, depth = 0) {
  if (depth > 1) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (SKIP_DIRS.has(entry.name)) return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return collect(full, depth + 1);
    return entry.isFile() && entry.name.endsWith('.js') ? [full] : [];
  });
}

const files = collect(root).sort();
let failed = 0;

for (const file of files) {
  const relative = path.relative(root, file);
  try {
    // نُزيل سطر الـ shebang (#!/usr/bin/env node) كما يفعل Node عند التحميل،
    // ثم نلفّ الملف بغلاف CommonJS حتى تُقبل require/module/exports.
    const source = fs.readFileSync(file, 'utf8').replace(/^#![^\n]*/, '');
    new vm.Script(`(function (exports, require, module, __filename, __dirname) {\n${source}\n});`, { filename: file });
    console.log(`✅ ${relative}`);
  } catch (error) {
    failed++;
    console.log(`❌ ${relative}\n     ${error.message}`);
  }
}

console.log('');
if (failed) {
  console.log(`❌ ${failed} ملف فيه خطأ نحوي من أصل ${files.length}.`);
  process.exit(1);
}
console.log(`✅ ${files.length} ملف — كلها صالحة نحوياً.`);
