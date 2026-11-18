// تنظيم — توثيق الـ API: يعرض وثيقة OpenAPI المولدة من الخادم (بدون مكتبات خارجية — يعمل داخل الشبكة المغلقة).
import '../core/style.css';
import { h, clear } from '../core/dom.js';

async function boot() {
    const spec = await (await fetch('/api/openapi.json')).json();
    const groups = {};
    for (const [p, ops] of Object.entries(spec.paths)) for (const [m, op] of Object.entries(ops)) (groups[op.tags?.[0] || 'misc'] ||= []).push({ p, m, op });
    const color = { get: 'var(--info)', post: 'var(--ok)', put: 'var(--warn)', delete: 'var(--bad)', patch: 'var(--accent)' };
    document.documentElement.dir = 'ltr';
    clear(document.getElementById('root'), h('div', { style: { maxWidth: '1100px', margin: '0 auto', padding: '28px 20px' } },
        h('div.page-head', h('div', h('h1', spec.info.title), h('p', `v${spec.info.version}`)), h('a.btn.primary', { href: '/api/openapi.json', download: 'tanzeem-openapi.json' }, 'openapi.json')),
        h('div.hint-box', { style: { marginBottom: '20px' } }, h('div', { dir: 'auto' }, spec.info.description)),
        Object.entries(groups).sort().map(([tag, ops]) => h('div.card', { style: { marginBottom: '14px' } }, h('div.card-h', h('h2', tag), h('span.small.muted', String(ops.length))),
            h('div', ops.map(({ p, m, op }) => h('details', { style: { borderTop: '1px solid var(--border)' } }, h('summary', { style: { padding: '9px 16px', cursor: 'pointer', display: 'flex', gap: '12px', alignItems: 'center' } },
                h('b.mono', { style: { color: color[m], width: '58px', textTransform: 'uppercase', fontSize: '12px' } }, m), h('span.mono', p), h('span.small.muted', { dir: 'auto', style: { marginInlineStart: 'auto' } }, op.summary || ''), op.security?.length === 0 ? h('span.badge.plain', 'public') : null),
                h('div', { style: { padding: '0 16px 12px 86px' } }, op.parameters?.length ? h('table.tbl', h('tbody', op.parameters.map((x) => h('tr', h('td.mono', x.name), h('td.small', x.in), h('td.small.mono', x.schema?.enum ? x.schema.enum.join(' | ') : x.schema?.type || ''), h('td.small', x.required ? 'required' : ''))))) : h('div.small.muted', 'No parameters'),
                    op.requestBody?.content?.['application/json']?.schema?.$ref ? h('pre.mono.small', { style: { background: 'var(--surface-2)', padding: '10px', borderRadius: '8px', overflow: 'auto' } }, JSON.stringify(spec.components.schemas[op.requestBody.content['application/json'].schema.$ref.split('/').pop()], null, 2)) : null))))))));
}
boot();
