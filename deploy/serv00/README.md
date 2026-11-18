# تنظيم على Serv00 — https://tanzeem.sari221.serv00.net

نفس طريقة «درب»: خادم Node واحد على منفذ محجوز، وأمامه موقع Proxy يدعم WebSocket. GitHub Actions يبني الواجهة ويرفع النسخة الجاهزة، والخادم لا يحتاج الوصول إلى GitHub. مجلد وقاعدة بيانات منفصلان تماماً عن درب.

```
~/tanzeem/.env          الإعدادات (PORT، APP_SECRET، PUBLIC_URL…)
~/tanzeem/data/         قاعدة البيانات SQLite + النسخ الاحتياطية (backups/)
~/tanzeem/app/          النسخة الحالية (تُستبدل مع كل نشر)
~/tanzeem/server.log    سجل الخادم (JSON)
```

## الإعداد (مرة واحدة) عبر SSH

```sh
# 1) حجز منفذ
devil port add tcp random
devil port list

# 2) موقع Proxy على المنفذ (استبدل 23456 بالرقم)
devil www add tanzeem.sari221.serv00.net proxy localhost 23456

# 3) شهادة HTTPS (استبدل IP بناتج: host sari221.serv00.net)
devil ssl www add IP le le tanzeem.sari221.serv00.net

# 4) ملف الإعدادات — APP_SECRET لا يُغيَّر بعد التشغيل (يوقّع رموز QR ويشفّر الحقول)
mkdir -p ~/tanzeem && printf 'PORT=23456\nHOST=127.0.0.1\nAPP_SECRET=%s\nDATA_DIR=%s/tanzeem/data\nPUBLIC_URL=https://tanzeem.sari221.serv00.net\nSEED_DEMO=1\nDEMO_PASSWORD=%s\n' "$(openssl rand -hex 32)" "$HOME" "Demo-$(openssl rand -hex 4)-2026!" > ~/tanzeem/.env
chmod 600 ~/tanzeem/.env
grep DEMO_PASSWORD ~/tanzeem/.env    # كلمة مرور الحسابات التجريبية

# 5) مفتاح النشر من GitHub
ssh-keygen -t ed25519 -f ~/.ssh/tanzeem_deploy -N "" -C tanzeem-deploy
cat ~/.ssh/tanzeem_deploy.pub >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys
cat ~/.ssh/tanzeem_deploy     # انسخه إلى GitHub → sariazad/tanzeem → Settings → Secrets → Actions → SERV00_SSH_KEY
rm ~/.ssh/tanzeem_deploy
```

ثم من GitHub: **Actions ← deploy ← Run workflow**. بعد انتهائه أنشئ حساب مدير النظام الحقيقي:

```sh
cd ~/tanzeem/app && node server/cli.js admin you@ksu.edu.sa "اسمك"
```

## الحسابات التجريبية (مع `SEED_DEMO=1`)

كلها بكلمة المرور `DEMO_PASSWORD` من `.env`:
`superadmin@tanzeem.demo` · `orgadmin@tanzeem.demo` · `organizer@tanzeem.demo` · `reception@tanzeem.demo` · `it@tanzeem.demo`
(مدير النظام يُطلب منه تفعيل التحقق الثنائي عند أول دخول.)

لإيقاف البيانات التجريبية في بيئة حقيقية: اجعل `SEED_DEMO=0` قبل أول تشغيل.

## ما يفعله النشر

1. GitHub يبني الواجهة ويرفع النسخة إلى `~/tanzeem/app.new`.
2. `deploy.sh`: يثبّت الاعتماديات، يأخذ نسخة احتياطية، يبدّل النسخة ويعيد التشغيل، ويضيف إلى crontab: فحص كل دقيقة، وتشغيل بعد إعادة تشغيل السيرفر، ونسخة احتياطية يومية 2:17 (يحتفظ بآخر 14).
3. يختبر الصفحات ويقيس زمن التحقق الحقيقي.

## الحدود على Serv00

ذاكرة 512MB (الخادم ~80MB)، و20 عملية للحساب كله. يكفي للتجربة والعرض؛ للإنتاج الحكومي استخدم التنصيب الداخلي (Docker) — راجع `docs/technical-guide.md`.
