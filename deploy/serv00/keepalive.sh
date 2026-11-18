#!/bin/sh
# تنظيم — يعمل كل دقيقة من cron: يعيد تشغيل الخادم إن لم يستجب، ويقصّ السجل.
BASE="$HOME/tanzeem"
PORT=$(grep -E '^PORT=' "$BASE/.env" 2>/dev/null | cut -d= -f2)
[ -n "$PORT" ] || exit 0
if ! fetch -q -T 5 -o /dev/null "http://127.0.0.1:$PORT/healthz" 2>/dev/null && ! curl -sf -m 5 -o /dev/null "http://127.0.0.1:$PORT/healthz" 2>/dev/null; then
    [ -f "$BASE/server.pid" ] && kill "$(cat "$BASE/server.pid")" 2>/dev/null
    rm -f "$BASE/server.pid"
    sh "$BASE/app/deploy/serv00/run.sh"
    echo "$(date '+%F %T') restarted" >> "$BASE/keepalive.log"
fi
[ -f "$BASE/server.log" ] && [ "$(wc -c < "$BASE/server.log")" -gt 5000000 ] && tail -c 1000000 "$BASE/server.log" > "$BASE/server.log.tmp" && mv "$BASE/server.log.tmp" "$BASE/server.log"
exit 0
