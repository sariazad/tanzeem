#!/bin/sh
# تنظيم — تنصيب داخلي بأمر واحد على خادم Linux فيه Docker:
#   sh install.sh tanzeem.ksu.edu.sa
# ينشئ .env بأسرار عشوائية، وشهادة مؤقتة ذاتية التوقيع إن لم توجد شهادة الجهة، ثم يشغّل النظام وينشئ مدير النظام.
set -eu
DOMAIN="${1:-$(hostname -f)}"
command -v docker >/dev/null || { echo "Docker غير مثبت"; exit 1; }
if [ ! -f .env ]; then
    printf 'APP_SECRET=%s\nPUBLIC_URL=https://%s\nSEED_DEMO=0\n' "$(openssl rand -hex 32)" "$DOMAIN" > .env
    chmod 600 .env
    echo "✔ أُنشئ .env (احتفظ بنسخة آمنة من APP_SECRET)"
fi
if [ ! -f deploy/certs/tanzeem.crt ]; then
    openssl req -x509 -nodes -newkey rsa:2048 -days 365 -subj "/CN=$DOMAIN" -keyout deploy/certs/tanzeem.key -out deploy/certs/tanzeem.crt 2>/dev/null
    echo "⚠ شهادة مؤقتة ذاتية التوقيع — استبدلها بشهادة الجهة في deploy/certs/"
fi
docker compose up -d --build
echo "بانتظار الخادم…"
for i in $(seq 1 30); do docker compose exec -T app wget -qO- http://127.0.0.1:3000/healthz >/dev/null 2>&1 && break; sleep 2; done
printf 'بريد مدير النظام: '; read ADMIN_EMAIL
docker compose exec app node server/cli.js admin "$ADMIN_EMAIL" "مدير النظام"
echo "✔ النظام يعمل: https://$DOMAIN"
