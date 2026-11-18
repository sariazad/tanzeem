// تنظيم — قاعدة بيانات SQLite المدمجة في Node (node:sqlite): لا شيء يحتاج بناءً على الخادم.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS orgs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE,
    name_ar TEXT NOT NULL,
    name_en TEXT,
    parent_id INTEGER REFERENCES orgs(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    name_ar TEXT NOT NULL,
    name_en TEXT,
    system INTEGER NOT NULL DEFAULT 0,
    permissions TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    username TEXT UNIQUE COLLATE NOCASE,
    phone TEXT,
    org_id INTEGER REFERENCES orgs(id) ON DELETE SET NULL,
    source TEXT NOT NULL DEFAULT 'local' CHECK (source IN ('local','ldap','oidc')),
    pass_hash TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled','locked')),
    mfa_secret TEXT,
    mfa_enabled INTEGER NOT NULL DEFAULT 0,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER,
    must_change_password INTEGER NOT NULL DEFAULT 0,
    lang TEXT NOT NULL DEFAULT 'ar',
    last_login TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    scope_type TEXT NOT NULL DEFAULT 'all' CHECK (scope_type IN ('all','org','event')),
    scope_id INTEGER,
    UNIQUE (user_id, role_id, scope_type, scope_id)
);

CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ip TEXT, ua TEXT,
    mfa_pending INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    revoked INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS venues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name_ar TEXT NOT NULL,
    name_en TEXT,
    address TEXT,
    map_bg TEXT,
    map_w INTEGER NOT NULL DEFAULT 1000,
    map_h INTEGER NOT NULL DEFAULT 600,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS forms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'event' CHECK (scope IN ('event','visit')),
    fields TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS badge_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    width_mm REAL NOT NULL DEFAULT 85.6,
    height_mm REAL NOT NULL DEFAULT 54,
    design TEXT NOT NULL DEFAULT '{}',
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER REFERENCES orgs(id) ON DELETE SET NULL,
    title_ar TEXT NOT NULL,
    title_en TEXT,
    type TEXT NOT NULL DEFAULT 'guests' CHECK (type IN ('students','guests','official')),
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','running','ended','cancelled')),
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    venue_id INTEGER REFERENCES venues(id) ON DELETE SET NULL,
    location TEXT,
    capacity INTEGER NOT NULL DEFAULT 0,
    audience TEXT,
    description TEXT,
    form_id INTEGER REFERENCES forms(id) ON DELETE SET NULL,
    badge_template_id INTEGER REFERENCES badge_templates(id) ON DELETE SET NULL,
    organizer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    open_registration INTEGER NOT NULL DEFAULT 1,
    archived INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS events_org ON events (org_id, status);

CREATE TABLE IF NOT EXISTS zones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    venue_id INTEGER REFERENCES venues(id) ON DELETE CASCADE,
    name_ar TEXT NOT NULL,
    name_en TEXT,
    kind TEXT NOT NULL DEFAULT 'hall' CHECK (kind IN ('stage','registration','hall','services','entrance','exhibition','vip','other')),
    capacity INTEGER NOT NULL DEFAULT 100,
    x REAL NOT NULL DEFAULT 20, y REAL NOT NULL DEFAULT 20, w REAL NOT NULL DEFAULT 200, h REAL NOT NULL DEFAULT 120,
    color TEXT
);

CREATE TABLE IF NOT EXISTS speakers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name_ar TEXT NOT NULL,
    name_en TEXT,
    title TEXT,
    org_name TEXT,
    bio TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS event_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    day INTEGER NOT NULL DEFAULT 1,
    track TEXT,
    title_ar TEXT NOT NULL,
    title_en TEXT,
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    hall TEXT,
    speaker_ids TEXT NOT NULL DEFAULT '[]',
    featured INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS visitors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name_ar TEXT NOT NULL,
    name_en TEXT,
    org_name TEXT,
    job_title TEXT,
    category TEXT NOT NULL DEFAULT 'guest' CHECK (category IN ('vip','guest','student','staff','media','speaker','contractor')),
    phone TEXT,
    email TEXT COLLATE NOCASE,
    national_id_enc TEXT,
    national_id_hash TEXT,
    national_id_last4 TEXT,
    photo TEXT,
    interests TEXT,
    blocked INTEGER NOT NULL DEFAULT 0,
    block_reason TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT
);
CREATE INDEX IF NOT EXISTS visitors_phone ON visitors (phone);
CREATE INDEX IF NOT EXISTS visitors_email ON visitors (email);
CREATE INDEX IF NOT EXISTS visitors_nid ON visitors (national_id_hash);

CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'delegation' CHECK (kind IN ('delegation','cohort','org','other')),
    org_id INTEGER REFERENCES orgs(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS group_members (
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    visitor_id INTEGER NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
    PRIMARY KEY (group_id, visitor_id)
);

CREATE TABLE IF NOT EXISTS visits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER REFERENCES orgs(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    purpose TEXT,
    host_name TEXT,
    host_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    location TEXT,
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','permit_issued','checked_in','checked_out','rejected','cancelled')),
    form_id INTEGER REFERENCES forms(id) ON DELETE SET NULL,
    notes TEXT,
    created_by INTEGER,
    approved_by INTEGER,
    approved_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS visit_visitors (
    visit_id INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
    visitor_id INTEGER NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
    PRIMARY KEY (visit_id, visitor_id)
);

CREATE TABLE IF NOT EXISTS invitations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    visitor_id INTEGER NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
    channel TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email','sms','both','none')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','confirmed','declined','cancelled','expired','failed')),
    token TEXT NOT NULL UNIQUE,
    lang TEXT NOT NULL DEFAULT 'ar',
    sent_at TEXT, responded_at TEXT, remind_at TEXT, reminded_at TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (event_id, visitor_id)
);

CREATE TABLE IF NOT EXISTS registrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    visitor_id INTEGER NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
    source TEXT NOT NULL DEFAULT 'web' CHECK (source IN ('invite','web','kiosk','manual','bulk','import')),
    answers TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (event_id, visitor_id)
);

CREATE TABLE IF NOT EXISTS credentials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_type TEXT NOT NULL CHECK (subject_type IN ('event','visit')),
    subject_id INTEGER NOT NULL,
    visitor_id INTEGER NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
    nonce TEXT NOT NULL,
    valid_from TEXT,
    valid_to TEXT,
    revoked INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (subject_type, subject_id, visitor_id)
);

CREATE TABLE IF NOT EXISTS attendance_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_type TEXT NOT NULL CHECK (subject_type IN ('event','visit')),
    subject_id INTEGER NOT NULL,
    visitor_id INTEGER NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
    credential_id INTEGER,
    direction TEXT NOT NULL CHECK (direction IN ('in','out')),
    method TEXT NOT NULL CHECK (method IN ('qr','manual','kiosk','bulk','mobile')),
    gate TEXT,
    zone_id INTEGER,
    device_id INTEGER,
    user_id INTEGER,
    offline INTEGER NOT NULL DEFAULT 0,
    at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS att_subject ON attendance_logs (subject_type, subject_id, at);
CREATE INDEX IF NOT EXISTS att_visitor ON attendance_logs (visitor_id, at);

CREATE TABLE IF NOT EXISTS presence (
    subject_type TEXT NOT NULL,
    subject_id INTEGER NOT NULL,
    visitor_id INTEGER NOT NULL,
    inside INTEGER NOT NULL,
    zone_id INTEGER,
    first_in TEXT,
    last_at TEXT NOT NULL,
    PRIMARY KEY (subject_type, subject_id, visitor_id)
);

CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('kiosk','printer','scanner','checkin','gate')),
    location TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','online','offline','error','paper_low')),
    pair_code TEXT,
    pair_expires INTEGER,
    token_hash TEXT,
    version TEXT,
    last_seen INTEGER,
    event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
    printer_id INTEGER REFERENCES devices(id) ON DELETE SET NULL,
    zone_id INTEGER REFERENCES zones(id) ON DELETE SET NULL,
    gate TEXT,
    config TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS device_faults (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    message TEXT,
    at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS print_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id INTEGER REFERENCES devices(id) ON DELETE SET NULL,
    template_id INTEGER,
    visitor_id INTEGER REFERENCES visitors(id) ON DELETE SET NULL,
    subject_type TEXT, subject_id INTEGER,
    format TEXT NOT NULL DEFAULT 'browser' CHECK (format IN ('browser','zpl','pdf')),
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','printed','failed','preview')),
    error TEXT,
    user_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    done_at TEXT
);

CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','ack','resolved')),
    params TEXT NOT NULL DEFAULT '{}',
    entity TEXT, entity_id INTEGER,
    org_id INTEGER,
    dedupe TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    resolved_by INTEGER, resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS notif_status ON notifications (status, created_at);

CREATE TABLE IF NOT EXISTS integrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL CHECK (kind IN ('smtp','sms','ldap','oidc','calendar','webhook','ai')),
    name TEXT NOT NULL,
    config_enc TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('unknown','ok','error','disabled')),
    last_sync TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS integration_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    integration_id INTEGER NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
    ok INTEGER NOT NULL,
    action TEXT NOT NULL,
    message TEXT,
    at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    integration_id INTEGER NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
    event TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivered','failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    next_at INTEGER NOT NULL,
    last_status INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    prefix TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    role_id INTEGER REFERENCES roles(id) ON DELETE SET NULL,
    created_by INTEGER,
    last_used TEXT,
    revoked INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS report_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    report TEXT NOT NULL,
    params TEXT NOT NULL DEFAULT '{}',
    frequency TEXT NOT NULL DEFAULT 'daily' CHECK (frequency IN ('daily','weekly','monthly')),
    hour INTEGER NOT NULL DEFAULT 7,
    recipients TEXT NOT NULL,
    format TEXT NOT NULL DEFAULT 'xlsx' CHECK (format IN ('xlsx','csv')),
    enabled INTEGER NOT NULL DEFAULT 1,
    last_run TEXT,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    a_id INTEGER NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
    b_id INTEGER NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
    source TEXT NOT NULL DEFAULT 'recommendation',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (event_id, a_id, b_id)
);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- سجل التدقيق: إضافة فقط. سلسلة تجزئة تكشف أي عبث، والمشغّلات تمنع التعديل والحذف.
CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    user_id INTEGER,
    actor TEXT,
    action TEXT NOT NULL,
    entity TEXT,
    entity_id TEXT,
    before TEXT,
    after TEXT,
    ip TEXT,
    prev_hash TEXT,
    hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_entity ON audit_log (entity, entity_id);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
`;

export function openDb(file = config.dbFile) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    const db = new DatabaseSync(file);
    db.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;`);
    db.exec(SCHEMA);
    return db;
}

/** تنفيذ داخل معاملة. */
export function tx(db, fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
        const r = fn();
        db.exec('COMMIT');
        return r;
    } catch (e) {
        db.exec('ROLLBACK');
        throw e;
    }
}

export const one = (db, sql, ...a) => db.prepare(sql).get(...a) || null;
export const all = (db, sql, ...a) => db.prepare(sql).all(...a);
export const run = (db, sql, ...a) => db.prepare(sql).run(...a);

export function getSetting(db, key, fallback = null) {
    const r = one(db, 'SELECT value FROM settings WHERE key = ?', key);
    if (!r) return fallback;
    try { return JSON.parse(r.value); } catch { return fallback; }
}
export function setSetting(db, key, value) {
    run(db, 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
}
