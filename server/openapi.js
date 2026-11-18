// تنظيم — وثيقة OpenAPI 3.1 مولّدة من المسارات وتعريف الموارد (تُستورد في Swagger أو بوابة API Management مثل Apigee).
import { RESOURCES } from '../shared/resources.js';
import { VERSION } from './app.js';

const TYPE = { int: 'integer', number: 'number', bool: 'boolean', ref: 'integer', json: 'object', refs: 'array' };

export function buildOpenApi(router, cfg) {
    const schemas = {};
    for (const [name, d] of Object.entries(RESOURCES)) {
        const props = { id: { type: 'integer', readOnly: true } };
        for (const f of d.fields) {
            const p = { type: TYPE[f.type] || 'string' };
            if (f.type === 'select') p.enum = f.opts;
            if (f.type === 'datetime') p.format = 'date-time';
            if (f.type === 'email') p.format = 'email';
            if (f.type === 'refs') p.items = { type: 'integer' };
            if (f.ro) p.readOnly = true;
            if (f.virtual) p.writeOnly = true;
            if (f.min != null) p.minimum = f.min;
            if (f.max != null) p.maximum = f.max;
            props[f.key] = p;
        }
        schemas[name] = { type: 'object', properties: props, required: d.fields.filter((f) => f.req).map((f) => f.key) };
    }
    schemas.Error = { type: 'object', properties: { error: { type: 'string' }, errors: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, code: { type: 'string' } } } } } };

    const paths = {};
    const toPath = (p) => p.replace(/:(\w+)/g, '{$1}');
    for (const rt of router.routes) {
        if (!rt.pattern.startsWith('/api/')) continue;
        if (rt.pattern.includes(':resource')) {
            for (const [name, d] of Object.entries(RESOURCES)) {
                const p = toPath(rt.pattern.replace(':resource', name));
                paths[p] ||= {};
                const body = ['POST', 'PUT'].includes(rt.method) ? { requestBody: { content: { 'application/json': { schema: { $ref: `#/components/schemas/${name}` } } } } } : {};
                paths[p][rt.method.toLowerCase()] = { tags: [d.module], summary: `${rt.opts.summary} — ${name}`, parameters: params(rt.pattern.replace(':resource', name), rt.method === 'GET' && !rt.pattern.endsWith(':id') && !rt.pattern.endsWith('export') ? d : null), ...body, responses: resp() };
            }
            continue;
        }
        const p = toPath(rt.pattern);
        paths[p] ||= {};
        paths[p][rt.method.toLowerCase()] = { tags: [rt.opts.tag || 'misc'], summary: rt.opts.summary || '', parameters: params(rt.pattern), ...(rt.opts.public ? { security: [] } : {}), ...(['POST', 'PUT', 'PATCH'].includes(rt.method) ? { requestBody: { content: { 'application/json': { schema: { type: 'object' } } } } } : {}), responses: resp() };
    }
    return {
        openapi: '3.1.0',
        info: { title: 'Tanzeem — تنظيم API', version: VERSION, description: 'المنظومة الذكية لإدارة الفعاليات والزوار. المصادقة: جلسة (كوكي tz_sid + ترويسة X-Requested-With: tanzeem للطلبات المعدِّلة)، أو مفتاح API في X-API-Key، أو رمز جهاز في X-Device-Token. الأخطاء بصيغة {error, errors[]}. الـ Webhooks الصادرة موقّعة بترويسة X-Tanzeem-Signature: sha256=HMAC(secret, body).' },
        servers: [{ url: cfg.publicUrl }],
        components: {
            schemas,
            securitySchemes: { session: { type: 'apiKey', in: 'cookie', name: 'tz_sid' }, apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' }, device: { type: 'apiKey', in: 'header', name: 'X-Device-Token' } },
        },
        security: [{ session: [] }, { apiKey: [] }, { device: [] }],
        paths,
    };
}

function params(pattern, listDef) {
    const out = [...pattern.matchAll(/:(\w+)/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: m[1] === 'id' ? 'integer' : 'string' } }));
    if (listDef) {
        out.push({ name: 'q', in: 'query', schema: { type: 'string' } }, { name: 'page', in: 'query', schema: { type: 'integer' } }, { name: 'size', in: 'query', schema: { type: 'integer', maximum: 500 } },
            { name: 'sort', in: 'query', schema: { type: 'string' } }, { name: 'dir', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'] } });
        for (const f of listDef.fields.filter((x) => x.filter)) out.push({ name: `f_${f.key}`, in: 'query', schema: { type: TYPE[f.type] || 'string', ...(f.opts ? { enum: f.opts } : {}) } });
    }
    return out;
}
const resp = () => ({ 200: { description: 'OK' }, 401: { description: 'غير مصادق', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }, 403: { description: 'لا صلاحية' }, 422: { description: 'بيانات غير صالحة', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } } });
