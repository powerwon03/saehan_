-- 새한 프라텍 — Supabase(Postgres) 스키마
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

create table if not exists sp_factories (
  "company" text not null,
  "id" text,
  "name" text,
  "approval" text,
  "leader_phone" text,
  "anchor_date" text,
  primary key ("company", "id")
);

create table if not exists sp_posts (
  "company" text not null,
  "id" text,
  "factory_id" text,
  "code" text,
  "name" text,
  "kind" text,
  "role" text,
  "unmanned" boolean,
  "priority" integer,
  "default_need" integer,
  "active" boolean,
  "sort" integer,
  primary key ("company", "id")
);

create table if not exists sp_products (
  "company" text not null,
  "id" text,
  "code" text,
  "name" text,
  "urgent" boolean,
  "active" boolean,
  primary key ("company", "id")
);

create table if not exists sp_standards (
  "company" text not null,
  "id" text,
  "post_id" text,
  "product_id" text,
  "need" integer,
  "gender" text,
  primary key ("company", "id")
);

create table if not exists sp_plan (
  "company" text not null,
  "id" text,
  "date" text,
  "shift" text,
  "post_id" text,
  "product_id" text,
  "status" text,
  primary key ("company", "id")
);

create table if not exists sp_people (
  "company" text not null,
  "id" text,
  "emp_no" text,
  "name" text,
  "affiliation" text,
  "crew" text,
  "role" text,
  "gender" text,
  "phone" text,
  "factory_id" text,
  "lang" text,
  "fixed_post_id" text,
  "last_post_id" text,
  "experience" jsonb,
  "product_experience" jsonb,
  "skills" jsonb,
  "active" boolean,
  "hired_at" text,
  "left_at" text,
  primary key ("company", "id")
);

create table if not exists sp_assignments (
  "company" text not null,
  "id" text,
  "date" text,
  "shift" text,
  "factory_id" text,
  "post_id" text,
  "person_id" text,
  "source" text,
  "locked" boolean,
  "reason" text,
  "flags" jsonb,
  "counted" boolean,
  "created_at" text,
  primary key ("company", "id")
);

create table if not exists sp_boards (
  "company" text not null,
  "id" text,
  "date" text,
  "shift" text,
  "factory_id" text,
  "status" text,
  "stopped_post_ids" jsonb,
  primary key ("company", "id")
);

create table if not exists sp_absences (
  "company" text not null,
  "id" text,
  "date" text,
  "shift" text,
  "factory_id" text,
  "person_id" text,
  "post_id" text,
  "kind" text,
  "reported_by" text,
  "reason" text,
  "status" text,
  "resolved_person_id" text,
  "round" integer,
  "restore" jsonb,
  "created_at" text,
  "resolved_at" text,
  primary key ("company", "id")
);

create table if not exists sp_requests (
  "company" text not null,
  "id" text,
  "absence_id" text,
  "person_id" text,
  "round" integer,
  "rank" integer,
  "status" text,
  "sent_at" text,
  "expires_at" text,
  "responded_at" text,
  primary key ("company", "id")
);

create table if not exists sp_leaves (
  "company" text not null,
  "id" text,
  "person_id" text,
  "date" text,
  "kind" text,
  "status" text,
  "created_at" text,
  primary key ("company", "id")
);

create table if not exists sp_messages (
  "company" text not null,
  "id" text,
  "person_id" text,
  "body" text,
  "channel" text,
  "at" text,
  primary key ("company", "id")
);

create table if not exists sp_settings (
  "company" text not null,
  "id" text,
  "data" jsonb,
  primary key ("company", "id")
);

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
  foreach t in array array['factories', 'posts', 'products', 'standards', 'plan', 'people', 'assignments', 'boards', 'absences', 'requests', 'leaves', 'messages', 'settings'] loop
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
    if not (t = any (array['factories', 'posts', 'products', 'standards', 'plan', 'people', 'assignments', 'boards', 'absences', 'requests', 'leaves', 'messages', 'settings'])) then raise exception 'unknown table %', t; end if;
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
alter table sp_companies enable row level security;
alter table sp_accounts enable row level security;
alter table sp_meta enable row level security;
alter table sp_factories enable row level security;
alter table sp_posts enable row level security;
alter table sp_products enable row level security;
alter table sp_standards enable row level security;
alter table sp_plan enable row level security;
alter table sp_people enable row level security;
alter table sp_assignments enable row level security;
alter table sp_boards enable row level security;
alter table sp_absences enable row level security;
alter table sp_requests enable row level security;
alter table sp_leaves enable row level security;
alter table sp_messages enable row level security;
alter table sp_settings enable row level security;

revoke all on function sp_load(text) from public;
revoke all on function sp_apply(text, bigint, jsonb) from public;

do $do$
declare t text;
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    foreach t in array array['sp_companies', 'sp_accounts', 'sp_meta', 'sp_factories', 'sp_posts', 'sp_products', 'sp_standards', 'sp_plan', 'sp_people', 'sp_assignments', 'sp_boards', 'sp_absences', 'sp_requests', 'sp_leaves', 'sp_messages', 'sp_settings'] loop
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
