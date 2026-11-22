// 저장소 백엔드. Supabase(Postgres)를 기본으로 쓰고, 키가 없으면 로컬 SQLite 파일로 돌아간다.
import fs from 'node:fs';
import path from 'node:path';
import { TABLES, sqliteSchema, sqlName, snake, type Row } from './schema';

export class StoreError extends Error {}

export interface CompanyRow { code: string; name: string; rev: number; demo: boolean }
export interface AccountRow {
  company: string;
  kind: 'admin' | 'worker';
  loginId: string;
  pwHash: string | null;
  fails: number;
  /** 잠금이 풀리는 시각(ms). 0 = 잠기지 않음 */
  lockedUntil: number;
}
export type Changes = Record<string, { put: Row[]; del: string[] }>;

export interface Backend {
  kind: 'supabase' | 'sqlite';
  /** 표가 준비됐는지 확인한다. 안 됐으면 StoreError */
  init(): Promise<void>;
  listCompanies(): Promise<CompanyRow[]>;
  getCompany(code: string): Promise<CompanyRow | null>;
  createCompany(code: string, name: string, demo: boolean): Promise<void>;
  load(code: string): Promise<{ rev: number; tables: Record<string, Row[]> } | null>;
  /** 버전이 맞을 때만 저장하고 새 버전을 돌려준다. 어긋나면 -1 */
  apply(code: string, rev: number, changes: Changes): Promise<number>;
  getAccount(company: string, kind: string, loginId: string): Promise<AccountRow | null>;
  listAccounts(company: string, kind: string): Promise<AccountRow[]>;
  putAccount(a: AccountRow): Promise<void>;
  deleteAccount(company: string, kind: string, loginId: string): Promise<void>;
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;
}

// ───────────────────────── Supabase ─────────────────────────

/** PostgREST 호출 창구. 테스트에서는 PGlite로 바꿔 끼운다. */
export interface Transport {
  rpc(fn: string, args: Record<string, unknown>): Promise<unknown>;
  select(table: string, filter: Record<string, string>): Promise<Row[]>;
  upsert(table: string, row: Row, ignoreDuplicates?: boolean): Promise<void>;
  remove(table: string, filter: Record<string, string>): Promise<void>;
}

export function httpTransport(url: string, key: string): Transport {
  const base = url.replace(/\/+$/, '') + '/rest/v1';
  const qs = (filter: Record<string, string>) =>
    Object.entries(filter).map(([k, v]) => `${encodeURIComponent(k)}=eq.${encodeURIComponent(v)}`).join('&');
  async function call(method: string, p: string, body?: unknown, prefer?: string) {
    let res: Response;
    try {
      res = await fetch(base + p, {
        method,
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          ...(prefer ? { Prefer: prefer } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store',
      });
    } catch {
      throw new StoreError('Supabase에 연결할 수 없습니다. 주소와 네트워크를 확인하세요.');
    }
    const text = await res.text();
    if (!res.ok) {
      let code = '', message = '';
      try { const j = JSON.parse(text); code = j.code ?? ''; message = j.message ?? ''; } catch { /* JSON이 아닌 응답 */ }
      if (res.status === 401 || res.status === 403) {
        throw new StoreError('Supabase 서비스 키가 올바르지 않습니다(.env.local 의 SUPABASE_SERVICE_ROLE_KEY).');
      }
      if (code === 'PGRST205' || code === 'PGRST202' || code === '42P01' || code === '42883') {
        throw new StoreError('Supabase에 표가 아직 없습니다. supabase/schema.sql 을 SQL Editor에서 한 번 실행하세요.');
      }
      throw new StoreError(`Supabase 오류(${res.status}${code ? ' ' + code : ''}): ${message || '알 수 없는 오류'}`);
    }
    return text ? JSON.parse(text) : null;
  }
  return {
    rpc: (fn, args) => call('POST', `/rpc/${fn}`, args),
    select: async (table, filter) => {
      const q = qs(filter);
      return ((await call('GET', `/${table}?select=*${q ? '&' + q : ''}`)) ?? []) as Row[];
    },
    upsert: async (table, row, ignore) => {
      await call('POST', `/${table}`, row, `resolution=${ignore ? 'ignore' : 'merge'}-duplicates,return=minimal`);
    },
    remove: async (table, filter) => {
      await call('DELETE', `/${table}?${qs(filter)}`);
    },
  };
}

const toAccount = (r: Row): AccountRow => ({
  company: String(r.company), kind: r.kind as AccountRow['kind'], loginId: String(r.login_id),
  pwHash: (r.pw_hash as string | null) ?? null, fails: Number(r.fails ?? 0), lockedUntil: Number(r.locked_until ?? 0),
});
const toCompany = (r: Row): CompanyRow => ({ code: String(r.code), name: String(r.name), rev: Number(r.rev), demo: !!r.demo });

export function supabaseBackend(t: Transport): Backend {
  return {
    kind: 'supabase',
    async init() {
      await t.select('sp_companies', { code: '__check__' });
      await t.rpc('sp_load', { p_company: '__check__' });
    },
    listCompanies: async () => (await t.select('sp_companies', {})).map(toCompany),
    getCompany: async (code) => {
      const r = await t.select('sp_companies', { code });
      return r[0] ? toCompany(r[0]) : null;
    },
    createCompany: (code, name, demo) => t.upsert('sp_companies', { code, name, demo, rev: 0 }, true),
    load: async (code) => {
      const r = (await t.rpc('sp_load', { p_company: code })) as { rev: number; tables: Record<string, Row[]> } | null;
      return r ? { rev: Number(r.rev), tables: r.tables } : null;
    },
    apply: async (code, rev, changes) => Number(await t.rpc('sp_apply', { p_company: code, p_rev: rev, p_changes: changes })),
    getAccount: async (company, kind, loginId) => {
      const r = await t.select('sp_accounts', { company, kind, login_id: loginId });
      return r[0] ? toAccount(r[0]) : null;
    },
    listAccounts: async (company, kind) => (await t.select('sp_accounts', { company, kind })).map(toAccount),
    putAccount: (a) => t.upsert('sp_accounts', {
      company: a.company, kind: a.kind, login_id: a.loginId, pw_hash: a.pwHash, fails: a.fails, locked_until: a.lockedUntil,
    }),
    deleteAccount: (company, kind, loginId) => t.remove('sp_accounts', { company, kind, login_id: loginId }),
    getMeta: async (key) => ((await t.select('sp_meta', { key }))[0]?.value as string | undefined) ?? null,
    setMeta: (key, value) => t.upsert('sp_meta', { key, value }),
  };
}

// ───────────────────────── SQLite (로컬) ─────────────────────────

export function sqliteBackend(file: string): Backend {
  // 번들러가 node:sqlite 를 모르는 경우가 있어 실행 중에 꺼내 쓴다.
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec(sqliteSchema());

  const all = (sql: string, ...p: (string | number | null)[]) => db.prepare(sql).all(...p) as Row[];
  const run = (sql: string, ...p: (string | number | null)[]) => { db.prepare(sql).run(...p); };

  const enc = (table: string, row: Row) =>
    Object.entries(TABLES[table]).map(([k, ty]) => {
      const v = row[snake(k)];
      if (v === null || v === undefined) return null;
      if (ty === 'j') return JSON.stringify(v);
      if (ty === 'b') return v ? 1 : 0;
      return v as string | number;
    });
  const dec = (table: string, r: Row) => {
    const out: Row = {};
    for (const [k, ty] of Object.entries(TABLES[table])) {
      const v = r[snake(k)];
      out[snake(k)] = v === null || v === undefined ? null : ty === 'j' ? JSON.parse(String(v)) : ty === 'b' ? !!v : v;
    }
    return out;
  };

  return {
    kind: 'sqlite',
    async init() {},
    listCompanies: async () => all('SELECT * FROM sp_companies').map(toCompany),
    getCompany: async (code) => {
      const r = all('SELECT * FROM sp_companies WHERE code = ?', code);
      return r[0] ? toCompany(r[0]) : null;
    },
    createCompany: async (code, name, demo) => {
      run('INSERT OR IGNORE INTO sp_companies (code, name, rev, demo, created_at) VALUES (?, ?, 0, ?, ?)', code, name, demo ? 1 : 0, new Date().toISOString());
    },
    load: async (code) => {
      const c = all('SELECT rev FROM sp_companies WHERE code = ?', code)[0];
      if (!c) return null;
      const tables: Record<string, Row[]> = {};
      for (const t of Object.keys(TABLES)) {
        tables[t] = all(`SELECT * FROM ${sqlName(t)} WHERE company = ?`, code).map((r) => dec(t, r));
      }
      return { rev: Number(c.rev), tables };
    },
    apply: async (code, rev, changes) => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const c = all('SELECT rev FROM sp_companies WHERE code = ?', code)[0];
        if (!c) throw new StoreError(`없는 회사: ${code}`);
        if (Number(c.rev) !== rev) { db.exec('ROLLBACK'); return -1; }
        for (const [t, ch] of Object.entries(changes)) {
          if (!TABLES[t]) throw new StoreError(`없는 표: ${t}`);
          const del = db.prepare(`DELETE FROM ${sqlName(t)} WHERE company = ? AND id = ?`);
          for (const id of ch.del) del.run(code, id);
          const cols = Object.keys(TABLES[t]).map((k) => `"${snake(k)}"`);
          const put = db.prepare(
            `INSERT OR REPLACE INTO ${sqlName(t)} ("company", ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`,
          );
          for (const row of ch.put) put.run(code, ...enc(t, row));
        }
        run('UPDATE sp_companies SET rev = ? WHERE code = ?', rev + 1, code);
        db.exec('COMMIT');
        return rev + 1;
      } catch (e) {
        try { db.exec('ROLLBACK'); } catch { /* 이미 끝난 트랜잭션 */ }
        throw e;
      }
    },
    getAccount: async (company, kind, loginId) => {
      const r = all('SELECT * FROM sp_accounts WHERE company = ? AND kind = ? AND login_id = ?', company, kind, loginId);
      return r[0] ? toAccount(r[0]) : null;
    },
    listAccounts: async (company, kind) => all('SELECT * FROM sp_accounts WHERE company = ? AND kind = ?', company, kind).map(toAccount),
    putAccount: async (a) => {
      run('INSERT OR REPLACE INTO sp_accounts (company, kind, login_id, pw_hash, fails, locked_until) VALUES (?, ?, ?, ?, ?, ?)',
        a.company, a.kind, a.loginId, a.pwHash, a.fails, a.lockedUntil);
    },
    deleteAccount: async (company, kind, loginId) => {
      run('DELETE FROM sp_accounts WHERE company = ? AND kind = ? AND login_id = ?', company, kind, loginId);
    },
    getMeta: async (key) => (all('SELECT value FROM sp_meta WHERE key = ?', key)[0]?.value as string | undefined) ?? null,
    setMeta: async (key, value) => { run('INSERT OR REPLACE INTO sp_meta (key, value) VALUES (?, ?)', key, value); },
  };
}
