// 표 정의. 사람·자리·계획·배치·결근·요청·휴무를 각각 표로 나눠 바뀐 행만 저장한다.
// Supabase(Postgres)와 로컬 SQLite가 같은 정의를 쓴다. 모든 표 이름은 sp_ 로 시작한다.
import type { State } from '@/lib/types';
import { COLLECTIONS } from '@/lib/types';

/** t = 글자, i = 정수, b = 참/거짓, j = JSON */
export type ColType = 't' | 'i' | 'b' | 'j';
export type Row = Record<string, unknown>;

export const TABLES: Record<string, Record<string, ColType>> = {
  factories: { id: 't', name: 't', approval: 't', leaderPhone: 't', anchorDate: 't' },
  posts: {
    id: 't', factoryId: 't', code: 't', name: 't', kind: 't', role: 't', unmanned: 'b',
    priority: 'i', defaultNeed: 'i', active: 'b', sort: 'i',
  },
  products: { id: 't', code: 't', name: 't', urgent: 'b', active: 'b' },
  standards: { id: 't', postId: 't', productId: 't', need: 'i', gender: 't' },
  plan: { id: 't', date: 't', shift: 't', postId: 't', productId: 't', status: 't' },
  people: {
    id: 't', empNo: 't', name: 't', affiliation: 't', crew: 't', role: 't', gender: 't', phone: 't',
    factoryId: 't', lang: 't', fixedPostId: 't', lastPostId: 't', experience: 'j', productExperience: 'j',
    skills: 'j', active: 'b', hiredAt: 't', leftAt: 't',
  },
  assignments: {
    id: 't', date: 't', shift: 't', factoryId: 't', postId: 't', personId: 't', source: 't', locked: 'b',
    reason: 't', flags: 'j', counted: 'b', createdAt: 't',
  },
  boards: { id: 't', date: 't', shift: 't', factoryId: 't', status: 't', stoppedPostIds: 'j' },
  absences: {
    id: 't', date: 't', shift: 't', factoryId: 't', personId: 't', postId: 't', kind: 't', reportedBy: 't',
    reason: 't', status: 't', resolvedPersonId: 't', round: 'i', restore: 'j', createdAt: 't', resolvedAt: 't',
  },
  requests: {
    id: 't', absenceId: 't', personId: 't', round: 'i', rank: 'i', status: 't', sentAt: 't', expiresAt: 't', respondedAt: 't',
  },
  leaves: { id: 't', personId: 't', date: 't', kind: 't', status: 't', createdAt: 't' },
  messages: { id: 't', personId: 't', body: 't', channel: 't', at: 't' },
  settings: { id: 't', data: 'j' },
};

export const TABLE_NAMES = Object.keys(TABLES);
export const snake = (k: string) => k.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
export const sqlName = (t: string) => `sp_${t}`;

/** 객체 → 표의 한 행(열 이름은 snake_case, 값은 그대로) */
export function toRow(table: string, obj: Record<string, unknown>): Row {
  const row: Row = {};
  for (const k of Object.keys(TABLES[table])) row[snake(k)] = obj[k] ?? null;
  return row;
}

export function fromRow(table: string, row: Row): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const k of Object.keys(TABLES[table])) obj[k] = row[snake(k)] ?? null;
  return obj;
}

/** 상태 → 표별 행 목록 */
export function stateToTables(s: State): Record<string, Row[]> {
  const out: Record<string, Row[]> = {};
  for (const c of COLLECTIONS) out[c] = (s[c] as unknown as Record<string, unknown>[]).map((o) => toRow(c, o));
  out.settings = [toRow('settings', { id: 'main', data: s.settings })];
  return out;
}

export function tablesToState(tables: Record<string, Row[]>, defaults: State['settings']): State {
  const s: Record<string, unknown> = {};
  for (const c of COLLECTIONS) s[c] = (tables[c] ?? []).map((r) => fromRow(c, r));
  const st = tables.settings?.[0]?.data as Partial<State['settings']> | undefined;
  s.settings = { ...defaults, ...(st ?? {}), weights: { ...defaults.weights, ...(st?.weights ?? {}) } };
  return s as unknown as State;
}

// ───────────── DDL ─────────────

const PG: Record<ColType, string> = { t: 'text', i: 'integer', b: 'boolean', j: 'jsonb' };
const LITE: Record<ColType, string> = { t: 'TEXT', i: 'INTEGER', b: 'INTEGER', j: 'TEXT' };

export function sqliteSchema(): string {
  const out: string[] = [
    `CREATE TABLE IF NOT EXISTS sp_companies (code TEXT PRIMARY KEY, name TEXT NOT NULL, rev INTEGER NOT NULL DEFAULT 0, demo INTEGER NOT NULL DEFAULT 0, created_at TEXT);`,
    `CREATE TABLE IF NOT EXISTS sp_accounts (company TEXT NOT NULL, kind TEXT NOT NULL, login_id TEXT NOT NULL, pw_hash TEXT, fails INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (company, kind, login_id));`,
    `CREATE TABLE IF NOT EXISTS sp_meta (key TEXT PRIMARY KEY, value TEXT);`,
  ];
  for (const [t, cols] of Object.entries(TABLES)) {
    const defs = Object.entries(cols).map(([k, ty]) => `"${snake(k)}" ${LITE[ty]}`).join(', ');
    out.push(`CREATE TABLE IF NOT EXISTS ${sqlName(t)} ("company" TEXT NOT NULL, ${defs}, PRIMARY KEY ("company", "id"));`);
  }
  return out.join('\n');
}

/** Supabase SQL Editor에서 한 번 실행하는 스키마. scripts/gen-schema.ts 가 supabase/schema.sql 로 내보낸다. */
export function postgresSchema(): string {
  const names = TABLE_NAMES.map((t) => `'${t}'`).join(', ');
  const all = ['sp_companies', 'sp_accounts', 'sp_meta', ...TABLE_NAMES.map(sqlName)];
  const tables = Object.entries(TABLES).map(([t, cols]) => {
    const defs = Object.entries(cols).map(([k, ty]) => `  "${snake(k)}" ${PG[ty]}`).join(',\n');
    return `create table if not exists ${sqlName(t)} (\n  "company" text not null,\n${defs},\n  primary key ("company", "id")\n);`;
  });
  return `-- 새한 프라텍 — Supabase(Postgres) 스키마
-- Supabase 대시보드 → SQL Editor 에 붙여 넣고 한 번 실행한다. 여러 번 실행해도 안전하다.
-- 모든 표는 sp_ 로 시작해 같은 프로젝트의 다른 표와 섞이지 않는다.
-- 이 파일은 src/server/schema.ts 에서 만든다(npm run schema). 직접 고치지 않는다.

create table if not exists sp_companies (
  code text primary key,
  name text not null,
  rev bigint not null default 0,
  demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists sp_accounts (
  company text not null,
  kind text not null,
  login_id text not null,
  pw_hash text,
  fails integer not null default 0,
  locked_until bigint not null default 0,
  primary key (company, kind, login_id)
);

create table if not exists sp_meta (
  key text primary key,
  value text
);

${tables.join('\n\n')}

-- 회사 데이터 전체 읽기(한 번의 호출, 일관된 버전)
create or replace function sp_load(p_company text) returns jsonb
language plpgsql set search_path = public as $fn$
declare
  t text;
  r jsonb;
  res jsonb := '{}'::jsonb;
  v bigint;
begin
  select rev into v from sp_companies where code = p_company for share;
  if v is null then return null; end if;
  foreach t in array array[${names}] loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from %I x where company = $1', 'sp_' || t)
      into r using p_company;
    res := res || jsonb_build_object(t, r);
  end loop;
  return jsonb_build_object('rev', v, 'tables', res);
end
$fn$;

-- 바뀐 행만 저장. 버전(rev)이 맞을 때만 한 트랜잭션으로 적용하고 새 버전을 돌려준다. 어긋나면 -1
create or replace function sp_apply(p_company text, p_rev bigint, p_changes jsonb) returns bigint
language plpgsql set search_path = public as $fn$
declare
  t text;
  ch jsonb;
  cur bigint;
begin
  select rev into cur from sp_companies where code = p_company for update;
  if cur is null then raise exception 'unknown company %', p_company; end if;
  if cur <> p_rev then return -1; end if;
  for t, ch in select key, value from jsonb_each(p_changes) loop
    if not (t = any (array[${names}])) then raise exception 'unknown table %', t; end if;
    if jsonb_array_length(coalesce(ch -> 'del', '[]'::jsonb)) > 0 then
      execute format('delete from %I where company = $1 and id in (select jsonb_array_elements_text($2))', 'sp_' || t)
        using p_company, ch -> 'del';
    end if;
    if jsonb_array_length(coalesce(ch -> 'put', '[]'::jsonb)) > 0 then
      execute format('delete from %I where company = $1 and id in (select x ->> ''id'' from jsonb_array_elements($2) x)', 'sp_' || t)
        using p_company, ch -> 'put';
      execute format('insert into %I select * from jsonb_populate_recordset(null::%I, $1)', 'sp_' || t, 'sp_' || t)
        using (select jsonb_agg(x || jsonb_build_object('company', p_company)) from jsonb_array_elements(ch -> 'put') x);
    end if;
  end loop;
  update sp_companies set rev = cur + 1 where code = p_company;
  return cur + 1;
end
$fn$;

-- 보안: 행 단위 보안(RLS)을 켜고 공개 정책을 두지 않는다. 브라우저는 직접 접근할 수 없고 서버만 서비스 키로 접근한다.
${all.map((t) => `alter table ${t} enable row level security;`).join('\n')}

revoke all on function sp_load(text) from public;
revoke all on function sp_apply(text, bigint, jsonb) from public;

do $do$
declare t text;
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    foreach t in array array[${all.map((t) => `'${t}'`).join(', ')}] loop
      execute format('revoke all on table %I from anon, authenticated', t);
      execute format('grant all on table %I to service_role', t);
    end loop;
    revoke all on function sp_load(text) from anon, authenticated;
    revoke all on function sp_apply(text, bigint, jsonb) from anon, authenticated;
    grant execute on function sp_load(text) to service_role;
    grant execute on function sp_apply(text, bigint, jsonb) to service_role;
  end if;
end
$do$;

notify pgrst, 'reload schema';
`;
}
