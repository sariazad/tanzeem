#!/bin/sh
# تنظيم — تثبيت نسخة جديدة على Serv00. GitHub Actions يرفعها إلى ~/tanzeem/app.new (الكود + الواجهة مبنية) ثم يشغّل هذا السكربت.
# البيانات في ~/tanzeem/data ولا تُمس. نسخة احتياطية قبل كل تحديث.
set -eu
BASE="$HOME/tanzeem"
NEW="$BASE/app.new"
[ -f "$BASE/.env" ] || { echo "لا يوجد $BASE/.env — راجع deploy/serv00/README.md"; exit 1; }
[ -f "$NEW/server/index.js" ] && [ -f "$NEW/dist/app.html" ] || { echo "النسخة الجديدة ناقصة"; exit 1; }

cd "$NEW"
npm ci --omit=dev --no-audit --no-fund --silent

# نسخة احتياطية متسقة قبل التحديث (إن وُجدت قاعدة)
if [ -f "$BASE/data/tanzeem.sqlite" ]; then
    DATA_DIR="$BASE/data" NODE_NO_WARNINGS=1 node server/cli.js backup "$BASE/data/backups" || true
fi

if [ -f "$BASE/server.pid" ]; then
    kill "$(cat "$BASE/server.pid")" 2>/dev/null || true
    sleep 1
    rm -f "$BASE/server.pid"
fi
rm -rf "$BASE/app.old"
[ -d "$BASE/app" ] && mv "$BASE/app" "$BASE/app.old"
mv "$NEW" "$BASE/app"
sh "$BASE/app/deploy/serv00/run.sh"
rm -rf "$BASE/app.old"

KEEP="sh $BASE/app/deploy/serv00/keepalive.sh"
BACKUP="cd $BASE/app && DATA_DIR=$BASE/data NODE_NO_WARNINGS=1 node server/cli.js backup $BASE/data/backups"
( crontab -l 2>/dev/null | grep -v 'tanzeem/app/deploy/serv00/keepalive.sh' | grep -v 'tanzeem/app && DATA_DIR' ; echo "* * * * * $KEEP >/dev/null 2>&1" ; echo "@reboot $KEEP >/dev/null 2>&1" ; echo "17 2 * * * $BACKUP >/dev/null 2>&1" ) | crontab -

PORT=$(grep -E '^PORT=' "$BASE/.env" | cut -d= -f2)
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
    if fetch -q -T 3 -o /dev/null "http://127.0.0.1:$PORT/healthz" 2>/dev/null || curl -sf -m 3 -o /dev/null "http://127.0.0.1:$PORT/healthz" 2>/dev/null; then
        echo "✔ تنظيم يعمل على المنفذ $PORT"
        exit 0
    fi
    sleep 1
done
echo "✗ الخادم لم يستجب. آخر السجل:"
tail -20 "$BASE/server.log"
exit 1
