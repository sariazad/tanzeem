#!/bin/sh
# تنظيم — تشغيل الخادم في الخلفية (يستدعيه keepalive.sh و deploy.sh).
BASE="$HOME/tanzeem"
APP="$BASE/app"
cd "$APP" || exit 1
mkdir -p "$BASE/data"
if [ -f "$BASE/server.pid" ] && kill -0 "$(cat "$BASE/server.pid")" 2>/dev/null; then
    exit 0
fi
NODE_ENV=production DATA_DIR="$BASE/data" DIST_DIR="$APP/dist" NODE_NO_WARNINGS=1 nohup node --max-old-space-size=320 server/index.js >> "$BASE/server.log" 2>&1 &
echo $! > "$BASE/server.pid"
