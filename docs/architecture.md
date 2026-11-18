# المعمارية

```mermaid
flowchart TB
    subgraph clients[الواجهات]
        A[لوحة التحكم /app]
        K[الكشك /kiosk]
        M[تطبيق الجوال /m — PWA]
        X[أنظمة أخرى — X-API-Key]
        P[Print Agent]
    end
    subgraph server[عملية Node.js واحدة]
        R[موجّه HTTP + CSRF + حد المعدل + ترويسات الأمان]
        AU[الهوية: جلسات، TOTP، LDAP، OIDC، مفاتيح API، رموز الأجهزة]
        RB[RBAC بنطاق: كل الجهات / جهة / فعالية]
        RS[CRUD مولّد من shared/resources.js + OpenAPI]
        S[الخدمات: الفعاليات، الدعوات، الحضور، الأجهزة، الطباعة، التقارير، الإشعارات، الذكاء، التكاملات]
        WS[WebSocket: قنوات dashboard / event:id / devices / announce:id / device:id]
        AD[سجل التدقيق — سلسلة تجزئة]
        SC[المهام الدورية: أجهزة منقطعة، Webhooks، تذكيرات، تقارير مجدولة، احتفاظ]
    end
    DB[(SQLite WAL\n data/tanzeem.sqlite)]
    EXT[SMTP · SMS HTTP · AD/LDAP · OIDC IdP · Webhooks · LLM داخلي]
    A & K & M & X --> R
    P <--> WS
    A & K & M <--> WS
    R --> AU --> RB --> RS & S
    S --> AD
    RS --> AD
    S & RS & AD --> DB
    S --> EXT
    SC --> S
```

## هيكل المجلدات

```
server/
  app.js            التجميع: المسارات، معالجة الطلبات، WebSocket، المهام الدورية، المقاييس
  config.js         الإعدادات من .env
  db.js             مخطط قاعدة البيانات (30 جدولاً) والمساعدات
  security.js       scrypt، AES-256-GCM، HMAC، TOTP، توقيع رموز QR
  auth.js           الجلسات والدخول المحلي/LDAP/OIDC والتحقق الثنائي
  resources.js      CRUD عام: بحث، فلاتر، ترتيب، ترقيم، تصدير، نطاق، تدقيق
  audit.js          سجل التدقيق بسلسلة تجزئة
  realtime.js       مركز WebSocket
  exporter.js       CSV وكاتب xlsx مدمج
  openapi.js        توليد OpenAPI 3.1
  seed.js           البيانات التجريبية
  cli.js            admin | seed-demo | backup | restore | verify-audit | retention
  services/         events · people (الزوار، المجموعات، الزيارات) · attendance · devices · notifications · reports · ai · integrations · admin
shared/             permissions.js (الوحدات والأدوار) · resources.js (تعريف الموارد والتحقق) · badge.js (SVG/ZPL) · messages.js (قوالب الرسائل)
web/
  app.html … m.html الصفحات المدخلية
  src/core/         dom، i18n (ar/en)، api، ws، theme، ui، charts، qr، scanner، printing، style.css
  src/app/          الهيكل والموجّه + components (table/form) + pages (16 صفحة + event-tabs الخمس)
  src/kiosk/        واجهة الكشك
  src/mobile/       تطبيق الجوال
tools/print-agent/  وكيل الطباعة
tests/              unit · server (تكامل) · e2e (Playwright) · load.mjs · k6-load.js · lint.mjs
deploy/             serv00/ (النشر) · nginx.conf · certs/
docs/               الوثائق
```

## نموذج البيانات (أهم الكيانات)

```mermaid
erDiagram
    orgs ||--o{ events : تنظم
    orgs ||--o{ visits : تستضيف
    users ||--o{ user_roles : لديه
    roles ||--o{ user_roles : يُسند
    venues ||--o{ zones : تضم
    venues ||--o{ events : تستضيف
    events ||--o{ event_sessions : جدول
    events ||--o{ invitations : دعوات
    events ||--o{ registrations : تسجيل
    visitors ||--o{ invitations : يُدعى
    visitors ||--o{ registrations : يسجل
    visitors ||--o{ credentials : يحمل
    visitors ||--o{ attendance_logs : يدخل_ويخرج
    visitors }o--o{ groups : عضو
    visits }o--o{ visitors : يشارك
    devices ||--o{ print_jobs : يطبع
    devices ||--o{ device_faults : أعطال
    forms ||--o{ events : نموذج
    badge_templates ||--o{ events : بطاقة
    integrations ||--o{ webhook_deliveries : يرسل
```

جداول إضافية:

| الجدول | الدور |
|---|---|
| `presence` | الإشغال اللحظي ومنع الدخول المزدوج |
| `sessions` | جلسات الدخول |
| `notifications` | التنبيهات |
| `api_keys` | مفاتيح الأنظمة الأخرى |
| `report_schedules` | التقارير المجدولة |
| `connections` | التعارف بين المشاركين |
| `settings` | الإعدادات |
| `audit_log` | سجل التدقيق |
| `integration_logs` | سجل التكاملات |
