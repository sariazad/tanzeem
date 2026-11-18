# الدليل التقني

## المتطلبات

**التنصيب الداخلي (موصى به):**
- خادم Linux، بمواصفات 2 vCPU و2GB RAM و20GB قرص.
- Docker 24+ مع Compose.
- شهادة TLS من الجهة.

**بلا Docker:** Node.js 22.13 أو أحدث، فقط. لا يحتاج النظام PostgreSQL ولا Redis.

## التنصيب بأمر واحد

```sh
git clone <repo> tanzeem && cd tanzeem
sh install.sh tanzeem.example.gov.sa
```

ماذا يفعل السكربت:
- يُنشئ `.env` بـ `APP_SECRET` عشوائي، ويضبط `SEED_DEMO=0`.
- يُنشئ شهادة مؤقتة ذاتية التوقيع إن لم توجد شهادة. استبدلها بشهادة الجهة في `deploy/certs/tanzeem.crt` و`.key`.
- يشغّل `docker compose up -d`، فتعمل ثلاث خدمات:
  - **app:** الخادم.
  - **nginx:** TLS وWebSocket.
  - **backup:** نسخة يومية إلى `./backups`.
- يطلب بريد مدير النظام.

## الإعدادات (`.env`)

| المتغير | الوصف |
|---|---|
| `APP_SECRET` | **إلزامي في الإنتاج.** تُشتق منه مفاتيح التشفير وتوقيع QR. **لا يُغيَّر بعد التشغيل**، واحفظ نسخة منه في خزنة الأسرار |
| `PUBLIC_URL` | الرابط العام، ويُستخدم في الدعوات والدخول الموحد |
| `PORT` و`HOST` | منفذ الاستماع وعنوانه |
| `DATA_DIR` | مكان قاعدة البيانات |
| `SEED_DEMO` | `1` لإضافة بيانات تجريبية على قاعدة فارغة فقط |
| `DEMO_PASSWORD` | كلمة مرور الحسابات التجريبية |
| `SESSION_IDLE_MINUTES` | مهلة خمول الجلسة. الافتراضي 720 |
| `TRUST_PROXY` | `1` خلف Nginx، لقراءة `X-Forwarded-For` |
| `METRICS_TOKEN` | لحماية `/metrics` عند الوصول من خارج الشبكة الداخلية |

## النسخ الاحتياطي والاستعادة

```sh
node server/cli.js backup /backups            # VACUUM INTO: نسخة متسقة أثناء التشغيل، ويُحتفظ بآخر 14
# الاستعادة: أوقف الخادم أولاً
docker compose stop app
docker compose run --rm app node server/cli.js restore /backups/tanzeem-2026-11-18T02-17-00.sqlite
docker compose start app
```

- `restore` يتحقق من سلامة النسخة (`integrity_check`)، ويحتفظ بالقاعدة السابقة باسم `.before-restore`.
- **اختبار الاستعادة دورياً (موصى به شهرياً):**
  1. استعد آخر نسخة على بيئة اختبار.
  2. شغّل `verify-audit`.
  3. افتح التقارير.
- يجب أن تُنسخ مع البيانات `APP_SECRET`. بدونه لا تُفك الحقول المشفرة، ولا تعمل رموز QR.

## التحديث

```sh
git pull && docker compose up -d --build
```

- الترحيلات تلقائية: الجداول تُنشأ بـ `IF NOT EXISTS`.
- على Serv00 يتم النشر تلقائياً من GitHub Actions، مع نسخة احتياطية قبل كل تحديث.

## المراقبة

| النقطة | الوصف |
|---|---|
| `GET /healthz` | فحص الصحة، ويُستخدم في Docker HEALTHCHECK وفي keepalive |
| `GET /metrics` | صيغة Prometheus: الطلبات حسب الفئة، وعدد عمليات التحقق ومدرّج زمنها، واتصالات WebSocket، والإشغال، والأجهزة المتصلة، والذاكرة. متاح من الشبكة الداخلية فقط، أو بـ `METRICS_TOKEN` |
| السجلات | JSON سطراً بسطر إلى stdout، بلا بيانات شخصية. في Docker: `docker compose logs app` |

**تنبيهات مقترحة في Prometheus/Alertmanager:**
- `up == 0`
- `histogram_quantile(0.95, rate(tanzeem_scan_seconds_bucket[5m])) > 0.5`
- `tanzeem_devices_online` أقل من المتوقع وقت الفعاليات.

## اختبار التحمّل

```sh
node tests/load.mjs                                    # محلياً: 1200 تحقق، 25 جهازاً متزامناً
k6 run -e BASE=https://host -e DEVICE=tzd_… -e TOKENS=tokens.txt tests/k6-load.js   # 1000/دقيقة لمدة 5 دقائق
```

## استكشاف الأخطاء

| العَرَض | السبب المرجّح | الحل |
|---|---|---|
| «APP_SECRET مطلوب في الإنتاج» | `.env` ناقص | أضف `APP_SECRET` |
| كل رموز QR «رمز غير صالح» بعد نقل الخادم | تغيّر `APP_SECRET` | أعد القيمة الأصلية |
| اللوحة لا تتحدث لحظياً (النقطة رمادية) | Nginx لا يمرر WebSocket | تأكد من كتلة `/ws` في `deploy/nginx.conf` |
| الكشك «غير متصل» | انقطاع الشبكة أو إلغاء الربط | تحقق من الشبكة، أو أنشئ رمز ربط جديداً من الأجهزة |
| الدعوات «مرسلة» ولا تصل | البريد غير مضبوط (وضع السجل) | اضبط SMTP واستخدم «اختبار الاتصال» |
| فشل دخول AD | Bind DN أو الشهادة | «اختبار الاتصال» وسجل التكامل. لبيئة الاختبار فقط: تجاوز التحقق من الشهادة |
| الحساب مقفل | 5 محاولات فاشلة | انتظر 15 دقيقة، أو «فك القفل» من المستخدمين |
| فقد التحقق الثنائي | تغيّر الجوال | مدير النظام: «إعادة ضبط التحقق الثنائي» |
| بطء التقارير على بيانات ضخمة | فترة واسعة جداً | ضيّق الفترة أو صدّر الملف |

## الـ API

- **المرجع الكامل:** `/docs`، ويُصدَّر `/api/openapi.json` للاستيراد في Apigee أو Swagger.
- **المصادقة للأنظمة الأخرى:** `X-API-Key: tzk_…`.
- **الموارد العامة:** `GET/POST /api/v1/<resource>` و`GET/PUT/DELETE /api/v1/<resource>/<id>`، مع `q` و`f_<حقل>` و`sort` و`dir` و`page` و`size`.
- **الأخطاء:** `{ "error": "code", "errors": [{ "field": "…", "code": "…" }] }`.
