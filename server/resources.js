// تنظيم — CRUD عام مولَّد من shared/resources.js: بحث، فلاتر، ترتيب، ترقيم، تصدير، صلاحيات بنطاق، وتدقيق.
import { RESOURCES, coerce } from '../shared/resources.js';
import { one, all, run } from './db.js';
import { fail, toCsv } from './http.js';

const ident = (s) => { if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error('bad identifier'); return s; };

export function makeResources(app) {
    const { db } = app;
    const hooks = {}; // name → { beforeSave(ctx, data, before), afterSave(ctx, row, before), beforeDelete, decorate(rows) }

    const colCache = new Map();
    const tableCols = (t) => {
        if (!colCache.has(t)) colCache.set(t, new Set(all(db, `PRAGMA table_info(${ident(t)})`).map((c) => c.name)));
        return colCache.get(t);
    };
    const def = (name) => RESOURCES[name] || fail(404, 'no_resource');
    const fieldMap = (d) => Object.fromEntries(d.fields.map((f) => [f.key, f]));

    /** شرط النطاق لموارد تحمل org_id (الفعاليات والزيارات). */
    function scopeWhere(ctx, d, name, action = 'view') {
        if (!d.scope) return { sql: '', args: [] };
        const s = app.auth.scope(ctx, d.module, action);
        if (s.all) return { sql: '', args: [] };
        const parts = [];
        const args = [];
        if (s.orgs.length) { parts.push(`org_id IN (${s.orgs.map(() => '?').join(',')})`); args.push(...s.orgs); }
        if (name === 'events' && s.events.length) { parts.push(`id IN (${s.events.map(() => '?').join(',')})`); args.push(...s.events); }
        if (!parts.length) return { sql: '0', args: [] };
        return { sql: `(${parts.join(' OR ')})`, args };
    }

    function scopeCtx(name, row) {
        if (!row) return null;
        if (name === 'events') return { orgId: row.org_id, eventId: row.id };
        if (row.org_id !== undefined) return { orgId: row.org_id };
        if (row.event_id !== undefined) {
            const ev = one(db, 'SELECT org_id FROM events WHERE id = ?', row.event_id);
            return { orgId: ev?.org_id, eventId: row.event_id };
        }
        return null;
    }

    function readCols(d) {
        return ['id', ...d.fields.filter((f) => !f.virtual).map((f) => f.key), ...(d.table === 'devices' ? ['last_seen'] : []), ...(['events', 'visits', 'visitors', 'groups', 'forms', 'badge_templates', 'speakers', 'venues', 'orgs', 'devices', 'report_schedules'].includes(d.table) ? ['created_at'] : [])];
    }

    function addRefLabels(d, rows) {
        for (const f of d.fields.filter((x) => x.type === 'ref' && x.list)) {
            const rd = RESOURCES[f.ref] || (f.ref === 'users' ? { table: 'users', label: 'name' } : null);
            if (!rd) continue;
            const ids = [...new Set(rows.map((r) => r[f.key]).filter((v) => v != null))];
            if (!ids.length) continue;
            const map = new Map(all(db, `SELECT id, ${ident(rd.label)} label FROM ${ident(rd.table)} WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids).map((r) => [r.id, r.label]));
            for (const r of rows) r[`${f.key}__label`] = map.get(r[f.key]) ?? null;
        }
        return rows;
    }

    function list(ctx, name, extra = {}) {
        const d = def(name);
        app.auth.need(ctx, d.module, 'view');
        const q = { ...ctx.query, ...extra };
        const fm = fieldMap(d);
        const where = [];
        const args = [];
        const sc = scopeWhere(ctx, d, name);
        if (sc.sql) { where.push(sc.sql); args.push(...sc.args); }
        if (q.q) {
            const cols = d.fields.filter((f) => f.search).map((f) => f.key);
            if (cols.length) {
                where.push(`(${cols.map((c) => `${ident(c)} LIKE ?`).join(' OR ')}${name === 'visitors' ? ' OR national_id_hash = ?' : ''})`);
                const like = `%${String(q.q).replace(/[%_]/g, '')}%`;
                args.push(...cols.map(() => like));
                if (name === 'visitors') args.push(app.lookup(q.q));
            }
        }
        for (const [k, v] of Object.entries(q)) {
            const key = k.startsWith('f_') ? k.slice(2) : (d.parent === k ? k : null);
            if (!key || v === '' || v == null || !fm[key]) continue;
            if (fm[key].type === 'refs') continue;
            where.push(`${ident(key)} = ?`);
            args.push(fm[key].type === 'bool' ? (v === '1' || v === 'true' ? 1 : 0) : v);
        }
        const dateField = fm.starts_at ? 'starts_at' : 'created_at';
        if (q.from) { where.push(`${dateField} >= ?`); args.push(q.from); }
        if (q.to) { where.push(`${dateField} <= ?`); args.push(q.to); }
        if (extra.whereSql) { where.push(extra.whereSql); args.push(...(extra.whereArgs || [])); }
        const sortKey = q.sort && (fm[q.sort] || q.sort === 'id' || q.sort === 'created_at') ? q.sort : (d.sort || 'id');
        const dir = (q.dir || d.dir || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
        const size = Math.min(Math.max(Number(q.size) || 25, 1), q.export ? 50000 : 500);
        const page = Math.max(Number(q.page) || 1, 1);
        const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const total = one(db, `SELECT COUNT(*) n FROM ${ident(d.table)} ${w}`, ...args).n;
        const cols = readCols(d).map(ident).join(', ');
        let rows = all(db, `SELECT ${cols} FROM ${ident(d.table)} ${w} ORDER BY ${ident(sortKey)} ${dir}, id ${dir} LIMIT ? OFFSET ?`, ...args, size, (page - 1) * size);
        if (!q.export) rows = rows.map((r) => stripHeavy(d, r));
        addRefLabels(d, rows);
        if (hooks[name]?.decorate) rows = hooks[name].decorate(rows, ctx);
        return { rows, total, page, size };
    }

    const stripHeavy = (d, r) => {
        for (const f of d.fields) if ((f.type === 'image' || f.type === 'json') && !f.list && r[f.key] && String(r[f.key]).length > 2000) r[f.key] = '__omitted__';
        return r;
    };

    function get(ctx, name, id) {
        const d = def(name);
        const row = one(db, `SELECT ${readCols(d).map(ident).join(', ')} FROM ${ident(d.table)} WHERE id = ?`, Number(id));
        if (!row) fail(404, 'not_found');
        app.auth.need(ctx, d.module, 'view', scopeCtx(name, row) ? scopeCtx(name, row) : null);
        addRefLabels(d, [row]);
        return hooks[name]?.decorate ? hooks[name].decorate([row], ctx)[0] : row;
    }
    const raw = (name, id) => one(db, `SELECT * FROM ${ident(def(name).table)} WHERE id = ?`, Number(id));

    function clean(d, body, partial) {
        const out = {};
        const errors = [];
        for (const f of d.fields) {
            if (f.ro && !f.virtual) continue;
            if (!(f.key in body)) {
                if (!partial && f.req) errors.push({ field: f.key, code: 'required' });
                continue;
            }
            try {
                const v = coerce(f, body[f.key]);
                if (v !== undefined) out[f.key] = v;
            } catch (e) { errors.push({ field: e.field, code: e.code }); }
        }
        if (errors.length) fail(422, 'invalid', { errors });
        return out;
    }

    function create(ctx, name, body) {
        const d = def(name);
        const data = clean(d, body, false);
        app.auth.need(ctx, d.module, 'create', scopeCtx(name, data) || null);
        if (hooks[name]?.beforeSave) hooks[name].beforeSave(ctx, data, null);
        const tc = tableCols(d.table);
        const cols = Object.keys(data).filter((k) => tc.has(k) && k !== 'id');
        const r = run(db, `INSERT INTO ${ident(d.table)} (${cols.map(ident).join(',')}) VALUES (${cols.map(() => '?').join(',')})`, ...cols.map((c) => data[c]));
        const id = Number(r.lastInsertRowid);
        const row = raw(name, id);
        hooks[name]?.afterSave?.(ctx, row, null);
        app.audit.record(app.auth.actorOf(ctx), `${name}.create`, name, id, null, row);
        return get(ctx, name, id);
    }

    function update(ctx, name, id, body) {
        const d = def(name);
        const before = raw(name, id);
        if (!before) fail(404, 'not_found');
        app.auth.need(ctx, d.module, 'update', scopeCtx(name, before));
        const data = clean(d, body, true);
        if (d.scope && 'org_id' in data && data.org_id !== before.org_id) app.auth.need(ctx, d.module, 'update', scopeCtx(name, { ...before, ...data }));
        if (hooks[name]?.beforeSave) hooks[name].beforeSave(ctx, data, before);
        const tc = tableCols(d.table);
        const cols = Object.keys(data).filter((k) => tc.has(k) && k !== 'id');
        if (cols.length) run(db, `UPDATE ${ident(d.table)} SET ${cols.map((c) => `${ident(c)} = ?`).join(', ')} WHERE id = ?`, ...cols.map((c) => data[c]), Number(id));
        const row = raw(name, id);
        hooks[name]?.afterSave?.(ctx, row, before);
        app.audit.record(app.auth.actorOf(ctx), `${name}.update`, name, id, diffBefore(before, row), diffAfter(before, row));
        return get(ctx, name, id);
    }

    function remove(ctx, name, id) {
        const d = def(name);
        const before = raw(name, id);
        if (!before) fail(404, 'not_found');
        app.auth.need(ctx, d.module, 'delete', scopeCtx(name, before));
        hooks[name]?.beforeDelete?.(ctx, before);
        run(db, `DELETE FROM ${ident(d.table)} WHERE id = ?`, Number(id));
        app.audit.record(app.auth.actorOf(ctx), `${name}.delete`, name, id, before, null);
        return { ok: true };
    }

    function exportRows(ctx, name, format, labels) {
        const d = def(name);
        app.auth.need(ctx, d.module, 'export');
        const { rows } = list(ctx, name, { export: 1, size: 50000, page: 1 });
        const cols = [{ key: 'id', label: '#' }, ...d.fields.filter((f) => f.type !== 'image' && f.type !== 'json' && !f.virtual && f.type !== 'secret').map((f) => ({ key: f.type === 'ref' && rows[0] && `${f.key}__label` in rows[0] ? `${f.key}__label` : f.key, label: labels?.[f.key] || f.key }))];
        app.audit.record(app.auth.actorOf(ctx), `${name}.export`, name, null, null, { format, count: rows.length });
        return app.exporter.file(format, `${name}`, cols, rows);
    }

    return { list, get, raw, create, update, remove, exportRows, hooks, def, scopeCtx, scopeWhere, toCsv };
}

const diffBefore = (a, b) => Object.fromEntries(Object.keys(b).filter((k) => a[k] !== b[k]).map((k) => [k, a[k]]));
const diffAfter = (a, b) => Object.fromEntries(Object.keys(b).filter((k) => a[k] !== b[k]).map((k) => [k, b[k]]));
