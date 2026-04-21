# Code Bar

<div align="center">

تطبيق سطح مكتب لنظامي macOS وWindows مبني باستخدام Tauri وReact، مع مدخل من شريط القوائم / درج النظام، لإدارة جلسات عدة أدوات برمجة بالذكاء الاصطناعي مثل Claude Code وCodex وواجهات CLI المخصصة، مع عزل Git worktree وتكامل PTY واستمرارية حالة الجلسات.

<p>
  <a href="https://github.com/For-Tr/Code-Bar/releases/latest/download/code-bar-windows-x64.msi">Windows x64 MSI</a> |
  <a href="https://github.com/For-Tr/Code-Bar/releases/latest/download/code-bar-macos-apple-silicon.dmg">macOS Apple Silicon</a> |
  <a href="https://github.com/For-Tr/Code-Bar/releases/latest/download/code-bar-macos-intel.dmg">macOS Intel</a>
</p>

<p>
  <a href="https://github.com/For-Tr/Code-Bar/releases/latest">أحدث إصدار</a> |
  <a href="https://github.com/For-Tr/Code-Bar/actions/workflows/release.yml">سير عمل الإصدار</a> |
  <a href="https://github.com/For-Tr/Code-Bar/actions">جميع الإجراءات</a>
</p>

[English](./README.md) | [简体中文](./README.zh.md) | العربية

</div>

## 👀 لقطات الشاشة

<p align="center">
  <img src="https://i.meee.com.tw/LQHF9Yg.png" alt="الصفحة الرئيسية" width="31%" />
  <img src="https://i.meee.com.tw/PIGq5LH.png" alt="إنشاء الجلسة" width="31%" />
  <img src="https://i.meee.com.tw/Bee0jnq.png" alt="إعدادات CLI" width="31%" />
</p>
<p align="center"><em>الصفحة الرئيسية · إنشاء الجلسة · إعدادات CLI</em></p>

## ✨ المزايا

- **Universal Runner**: إدارة Claude Code وOpenAI Codex وأدوات CLI المخصصة وNative Harness من مكان واحد.
- **Multi-Provider**: دعم Anthropic وOpenAI وDeepSeek وأي واجهة متوافقة مع OpenAI.
- **Git Worktree Isolation**: عزل كل جلسة داخل worktree مستقل لتجنب تعارضات العمل بين الجلسات.
- **PTY Terminal**: طرفية xterm.js كاملة لكل جلسة داخل التطبيق.
- **Git Diff Viewer**: عرض فروقات Git بشكل حي مع diff2html.
- **Adaptive Theme**: سمات فاتحة وداكنة وتتبع النظام.
- **Notifications**: إشعارات أصلية مع التركيز عند النقر على macOS وتدرج مناسب على Windows.

## 🚀 البدء السريع

### المتطلبات

- Node.js 18+
- pnpm
- Rust لواجهة Tauri الخلفية

### التثبيت

```bash
git clone https://github.com/For-Tr/code-bar.git
cd code-bar
pnpm install
```

### التطوير

```bash
pnpm tauri dev
```

### البناء

```bash
pnpm build
pnpm tauri build
```

## 📖 نظرة عامة على المشروع

### إدارة الجلسات

- إنشاء وحذف الجلسات حسب مساحة العمل.
- تتبع حالات الجلسات: idle / running / waiting / suspended / done / error.
- حفظ حالة الجلسات بين مرات التشغيل.
- بث PTY مباشر داخل التطبيق.

### إدارة مساحات العمل

- إضافة عدة مجلدات مشاريع والتبديل السريع بينها.
- الثقة التلقائية بمجلدات العمل عند الحاجة.
- إنشاء worktree خاص بكل جلسة عند بدء جلسة جديدة.

### تكامل Git

- عرض تغييرات الملفات حسب الجلسة.
- مقارنة branch-aware بين base وsession branch.
- عرض hunks وتفاصيل الفروقات داخل الواجهة.

## 🛠️ التقنيات

- **Frontend**: React 19 + TypeScript + Vite + Zustand + xterm.js
- **Backend**: Tauri 2 + Rust + portable-pty
- **Diff**: diff2html
- **Notifications**: mac-notification-sys / tauri-plugin-notification

## 📁 البنية

```text
code-bar/
├── src/         # واجهة React
├── src-tauri/   # واجهة Tauri الخلفية بلغة Rust
├── public/      # الموارد العامة
└── package.json
```

## 🎯 اختصارات لوحة المفاتيح

- `Esc` — إغلاق النافذة
- `Ctrl/Cmd + ,` — فتح الإعدادات

## 🤝 المساهمة

نرحب بالمشكلات وطلبات السحب.

1. انسخ المستودع
2. أنشئ فرعًا جديدًا
3. نفّذ التغييرات
4. ادفع الفرع إلى GitHub
5. افتح Pull Request

## 📄 الترخيص

هذا المشروع مرخص تحت Apache License 2.0. راجع ملف [LICENSE](LICENSE).
