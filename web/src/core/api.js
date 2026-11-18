// تنظيم — طبقة الاتصال بالـ API: JSON، رأس CSRF، أخطاء موحّدة، وتنزيل الملفات.
export class ApiError extends Error {
    constructor(status, body) { super(body?.error || `HTTP ${status}`); this.status = status; this.code = body?.error; this.errors = body?.errors || []; this.body = body; }
}
let deviceToken = null;
export const setDeviceToken = (t) => { deviceToken = t; };
let onAuthLost = null;
export const setOnAuthLost = (fn) => { onAuthLost = fn; };

export async function api(path, { method = 'GET', body, query, raw, signal } = {}) {
    let url = path.startsWith('/') ? path : `/api/v1/${path}`;
    if (query) {
        const q = new URLSearchParams();
        for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') q.set(k, v);
        const s = q.toString();
        if (s) url += (url.includes('?') ? '&' : '?') + s;
    }
    const headers = { 'X-Requested-With': 'tanzeem' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (deviceToken) headers['X-Device-Token'] = deviceToken;
    const res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: 'same-origin', signal });
    if (raw) { if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => ({}))); return res; }
    const data = res.status === 204 ? null : await res.json().catch(() => ({}));
    if (!res.ok) {
        if (res.status === 401 && onAuthLost && !path.includes('/auth/')) onAuthLost();
        throw new ApiError(res.status, data);
    }
    return data;
}
export const get = (p, query) => api(p, { query });
export const post = (p, body) => api(p, { method: 'POST', body: body ?? {} });
export const put = (p, body) => api(p, { method: 'PUT', body: body ?? {} });
export const del = (p) => api(p, { method: 'DELETE' });

/** تنزيل ملف من نقطة تصدير. */
export async function downloadFrom(path, query) {
    const res = await api(path, { query, raw: true });
    const cd = res.headers.get('Content-Disposition') || '';
    const name = (cd.match(/filename="([^"]+)"/) || [])[1] || 'export';
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
