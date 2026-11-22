import { beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { sqliteBackend, supabaseBackend, type Backend, type Changes, type Transport } from '@/server/backend';
import { postgresSchema, stateToTables, tablesToState, type Row } from '@/server/schema';
import { defaultSettings, seedDemo } from '@/lib/seed';
import { autoAssign, confirmBoard, reportAbsence } from '@/lib/flows';
import { seoulMs } from '@/lib/dates';

const PK: Record<string, string[]> = { sp_companies: ['code'], sp_accounts: ['company', 'kind', 'login_id'], sp_meta: ['key'] };

/** Supabase(PostgREST) 대신 같은 스키마 SQL을 올린 인프로세스 Postgres로 검증한다 */
function pgTransport(db: PGlite): Transport {
  return {
    rpc: async (fn, a) => {
      if (fn === 'sp_load') return (await db.query<{ r: unknown }>('select sp_load($1) as r', [a.p_company])).rows[0].r;
      if (fn === 'sp_apply') {
        return (await db.query<{ r: unknown }>('select sp_apply($1, $2, $3::jsonb) as r', [a.p_company, a.p_rev, JSON.stringify(a.p_changes)])).rows[0].r;
      }
      throw new Error(`unknown rpc ${fn}`);
    },
    select: async (table, filter) => {
      const keys = Object.keys(filter);
      const where = keys.length ? ` where ${keys.map((k, i) => `"${k}" = $${i + 1}`).join(' and ')}` : '';
      return (await db.query<Row>(`select * from ${table}${where}`, Object.values(filter))).rows;
    },
    upsert: async (table, row, ignore) => {
      const keys = Object.keys(row);
      const set = keys.filter((k) => !PK[table].includes(k)).map((k) => `"${k}" = excluded."${k}"`).join(', ');
      await db.query(
        `insert into ${table} (${keys.map((k) => `"${k}"`).join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')})
         on conflict (${PK[table].join(', ')}) do ${ignore || !set ? 'nothing' : `update set ${set}`}`,
        Object.values(row),
      );
    },
    remove: async (table, filter) => {
      const keys = Object.keys(filter);
      await db.query(`delete from ${table} where ${keys.map((k, i) => `"${k}" = $${i + 1}`).join(' and ')}`, Object.values(filter));
    },
  };
}

function sample() {
  const s = seedDemo();
  const now = seoulMs('2025-04-28', '06:00');
  autoAssign(s, 'f1', '2025-04-28', 'night', now);
  confirmBoard(s, 'f1', '2025-04-28', 'night', now);
  reportAbsence(s, { personId: s.assignments[3].personId, date: '2025-04-28', shift: 'night', kind: 'absent', reportedBy: 'self' }, now);
  return s;
}
const all = (tables: Record<string, Row[]>): Changes =>
  Object.fromEntries(Object.entries(tables).map(([t, rows]) => [t, { put: rows, del: [] }]));
const norm = (v: unknown) => JSON.parse(JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x)));

function suite(name: string, make: () => Promise<Backend>) {
  describe(name, () => {
    let b: Backend;
    beforeAll(async () => { b = await make(); await b.init(); });

    it('회사를 만들고, 표 단위로 저장한 상태를 그대로 다시 읽는다', async () => {
      const s = sample();
      await b.createCompany('t1', '테스트', false);
      await b.createCompany('t1', '다른 이름', false); // 이미 있으면 그대로
      expect(await b.getCompany('t1')).toMatchObject({ code: 't1', name: '테스트', rev: 0, demo: false });
      expect(await b.apply('t1', 0, all(stateToTables(s)))).toBe(1);
      const loaded = await b.load('t1');
      expect(loaded!.rev).toBe(1);
      const back = tablesToState(loaded!.tables, defaultSettings());
      for (const k of Object.keys(s) as (keyof typeof s)[]) {
        const sort = (x: unknown) => (Array.isArray(x) ? [...x].sort((p, q) => (p.id < q.id ? -1 : 1)) : x);
        expect(norm(sort(back[k])), k).toEqual(norm(sort(s[k])));
      }
    });

    it('버전이 어긋나면 저장하지 않고 -1', async () => {
      expect(await b.apply('t1', 0, { messages: { put: [], del: ['x'] } })).toBe(-1);
      expect((await b.getCompany('t1'))!.rev).toBe(1);
    });

    it('바뀐 행만 넣고 지운다', async () => {
      const before = (await b.load('t1'))!;
      const person: Row = { ...before.tables.people[0], name: '바뀐 이름', skills: { 'f1-L1': 3 } };
      const gone = String(before.tables.messages[0].id);
      expect(await b.apply('t1', 1, { people: { put: [person], del: [] }, messages: { put: [], del: [gone] } })).toBe(2);
      const after = (await b.load('t1'))!;
      expect(after.tables.people).toHaveLength(before.tables.people.length);
      expect(after.tables.people.find((p) => p.id === person.id)).toMatchObject({ name: '바뀐 이름', skills: { 'f1-L1': 3 } });
      expect(after.tables.messages.some((m) => m.id === gone)).toBe(false);
      expect(after.tables.assignments).toHaveLength(before.tables.assignments.length);
    });

    it('회사끼리 데이터가 섞이지 않는다', async () => {
      await b.createCompany('t2', '둘째', true);
      await b.apply('t2', 0, { products: { put: [{ id: 'only', code: 'X', name: '둘째 회사 제품', urgent: false, active: true }], del: [] } });
      expect((await b.load('t2'))!.tables.products.map((p) => p.id)).toEqual(['only']);
      expect((await b.load('t1'))!.tables.products.some((p) => p.id === 'only')).toBe(false);
      expect((await b.listCompanies()).map((c) => c.code).sort()).toEqual(['t1', 't2']);
      expect(await b.load('nope')).toBeNull();
    });

    it('계정·메타 저장', async () => {
      expect(await b.getAccount('t1', 'admin', 'admin')).toBeNull();
      await b.putAccount({ company: 't1', kind: 'admin', loginId: 'admin', pwHash: 'h', fails: 0, lockedUntil: 0 });
      await b.putAccount({ company: 't1', kind: 'admin', loginId: 'admin', pwHash: 'h', fails: 2, lockedUntil: 1764000000000 });
      expect(await b.getAccount('t1', 'admin', 'admin')).toEqual({ company: 't1', kind: 'admin', loginId: 'admin', pwHash: 'h', fails: 2, lockedUntil: 1764000000000 });
      expect(await b.listAccounts('t1', 'admin')).toHaveLength(1);
      await b.deleteAccount('t1', 'admin', 'admin');
      expect(await b.getAccount('t1', 'admin', 'admin')).toBeNull();
      expect(await b.getMeta('k')).toBeNull();
      await b.setMeta('k', 'v1');
      await b.setMeta('k', 'v2');
      expect(await b.getMeta('k')).toBe('v2');
    });
  });
}

suite('로컬 SQLite 저장소', async () => sqliteBackend(':memory:'));

suite('Supabase(Postgres) 스키마 · sp_load / sp_apply', async () => {
  const db = new PGlite();
  await db.exec(postgresSchema());
  await db.exec(postgresSchema()); // 여러 번 실행해도 안전
  return supabaseBackend(pgTransport(db));
});
