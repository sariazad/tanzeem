// تنظيم — اختبار تحمّل k6 (على بيئة الاختبار الداخلية):
//   k6 run -e BASE=https://tanzeem.internal -e DEVICE=tzd_xxx -e TOKENS=tokens.txt tests/k6-load.js
// الهدف: 1000 تحقق/دقيقة لمدة 5 دقائق، p95 < 500ms، أخطاء < 1%.
import http from 'k6/http';
import { check } from 'k6';
import { SharedArray } from 'k6/data';

const tokens = new SharedArray('tokens', () => open(__ENV.TOKENS).split(/\s+/).filter(Boolean));
export const options = {
    scenarios: { peak: { executor: 'constant-arrival-rate', rate: 1000, timeUnit: '1m', duration: '5m', preAllocatedVUs: 40, maxVUs: 120 } },
    thresholds: { http_req_duration: ['p(95)<500'], http_req_failed: ['rate<0.01'] },
};
export default function () {
    const token = tokens[(__VU * 100000 + __ITER) % tokens.length];
    const r = http.post(`${__ENV.BASE}/api/v1/attendance/verify`, JSON.stringify({ token }), { headers: { 'Content-Type': 'application/json', 'X-Device-Token': __ENV.DEVICE } });
    check(r, { 'status 200': (x) => x.status === 200 });
}
