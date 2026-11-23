// 회사별 상태 읽기·저장. 서버가 유일한 원본이다.
// 읽을 때는 버전(rev)만 확인해 바뀌었으면 다시 받고, 저장할 때는 바뀐 행만 보낸다.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { State } from '@/lib/types';
import { touch } from '@/lib/engine';
import { expireRequests } from '@/lib/flows';
import { defaultSettings, emptyState, seedDemo, seedStructure, virtualize } from '@/lib/seed';
import { pinDemoClock, stageDemoPlan } from '@/lib/demo';
import { seoul } from '@/lib/dates';
import {
  httpTransport, sqliteBackend, supabaseBackend, StoreError, type Backend, type Changes, type CompanyRow,
} from './backend';
import { stateToTables, tablesToState, type Row } from './schema';
import { hashPassword } from './password';

export const DEFAULT_COMPANY = 'saehan';
export const DEMO_COMPANY = 'demo';
export const APP_NAME = '새한 프라텍';

interface Entry {
  rev: number;
  state: State;
  snap: Record<string, Map<string, string>>;
}

interface Globals {
  backend?: Promise<Backend>;
  cache: Map<string, Entry>;
  locks: Map<string, Promise<unknown>>;
  timer?: ReturnType<typeof setInterval>;
  note?: string;
}
const g = globalThis as unknown as { __saehan?: Globals };
const G: Globals = (g.__saehan ??= { cache: new Map(), locks: new Map() });

/** 오늘(서울 날짜). 기준 생산계획은 어제 날짜로 들어간다 */
const today = () => seoul(Date.now()).date;

export const demoEnabled = () => (process.env.DEMO ?? 'on').toLowerCase() !== 'off';

function makeBackend(): Backend {
  // 붙여 넣다가 따라 들어온 따옴표·공백·줄바꿈은 떼어 낸다
  const env = (v: string | undefined) => (v ?? '').trim().replace(/^["']|["']$/g, '');
  const url = env(process.env.SUPABASE_URL) || env(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = env(process.env.SUPABASE_SERVICE_ROLE_KEY);
  // STORAGE=local 이면 Supabase 설정이 있어도 이 컴퓨터의 파일에 저장한다(공용 데이터를 건드리지 않고 시험할 때)
  const local = (process.env.STORAGE ?? '').toLowerCase() === 'local';
  if (url && key && !local) return supabaseBackend(httpTransport(url, key));
  if (process.env.VERCEL && !local) {
    // Vercel에는 파일을 저장할 곳이 없어 로컬 파일로 돌아갈 수 없다.
    const missing = [!url && 'SUPABASE_URL', !key && 'SUPABASE_SERVICE_ROLE_KEY'].filter(Boolean).join(', ');
    throw new StoreError(`Vercel 환경 변수 ${missing} 이(가) 없습니다. Settings → Environment Variables 에 넣고 다시 배포(Redeploy)하세요.`);
  }
  if (url && !key && !local) {
    G.note = 'SUPABASE_SERVICE_ROLE_KEY 가 비어 있어 로컬 파일(data/saehan.db)에 저장하고 있습니다.';
    console.warn(`[${APP_NAME}] ${G.note}`);
  }
  return sqliteBackend(process.env.DB_PATH || path.join(process.cwd(), 'data', 'saehan.db'));
}

export function getBackend(): Promise<Backend> {
  if (!G.backend) {
    G.backend = (async () => {
      const b = makeBackend();
      await b.init();
      await bootstrap(b);
      if (!G.timer && !process.env.VERCEL) {
        // 요청 20분 만료는 화면이 열려 있지 않아도 서버가 1분마다 처리한다.
        G.timer = setInterval(() => { expireAll().catch(() => {}); }, 60_000);
        G.timer.unref?.();
      }
      return b;
    })();
    G.backend.catch(() => { G.backend = undefined; });
  }
  return G.backend;
}

export async function storageInfo() {
  const b = await getBackend();
  return { kind: b.kind, note: G.note ?? '' };
}

// ───────────── 처음 실행 ─────────────

function snapshot(state: State) {
  const tables = stateToTables(state);
  const snap: Record<string, Map<string, string>> = {};
  for (const [t, rows] of Object.entries(tables)) {
    snap[t] = new Map(rows.map((r) => [String(r.id), JSON.stringify(r)]));
  }
  return { tables, snap };
}

async function seedCompany(b: Backend, code: string, name: string, demo: boolean, state: State) {
  let c = await b.getCompany(code);
  if (!c) {
    await b.createCompany(code, name, demo);
    c = await b.getCompany(code);
  }
  if (c && c.rev === 0) {
    const { tables } = snapshot(state);
    const changes: Changes = {};
    for (const [t, rows] of Object.entries(tables)) changes[t] = { put: rows, del: [] };
    await b.apply(code, 0, changes);
  }
}

async function bootstrap(b: Backend) {
  await seedCompany(b, DEFAULT_COMPANY, APP_NAME, false, seedStructure(emptyState(), today()));
  if (demoEnabled()) {
    const demo = seedDemo(today());
    pinDemoClock(demo, Date.now());
    await seedCompany(b, DEMO_COMPANY, `${APP_NAME} 체험`, true, demo);
  }
  if (!(await b.getAccount(DEFAULT_COMPANY, 'admin', 'admin'))) {
    const fromEnv = process.env.ADMIN_PASSWORD;
    const pw = fromEnv || crypto.randomBytes(9).toString('base64url');
    await b.putAccount({ company: DEFAULT_COMPANY, kind: 'admin', loginId: 'admin', pwHash: await hashPassword(pw), fails: 0, lockedUntil: 0 });
    if (!fromEnv) {
      try {
        const file = path.join(process.cwd(), 'data', 'admin-password.txt');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, `새한 프라텍 관리자 첫 비밀번호\n아이디: admin\n비밀번호: ${pw}\n\n로그인한 뒤 「설정」에서 바꾸고 이 파일은 지우세요.\n`, 'utf8');
        console.log(`[${APP_NAME}] 관리자 첫 비밀번호를 data/admin-password.txt 에 적었습니다.`);
      } catch {
        console.warn(`[${APP_NAME}] 관리자 비밀번호 파일을 쓸 수 없습니다. ADMIN_PASSWORD 환경 변수를 설정하거나 npm run company 로 다시 정하세요.`);
      }
    }
  }
}

// ───────────── 읽기·저장 ─────────────

export class NotFound extends Error {}

async function entry(b: Backend, company: string): Promise<Entry> {
  const c = await b.getCompany(company);
  if (!c) throw new NotFound('없는 회사입니다.');
  const cached = G.cache.get(company);
  if (cached && cached.rev === c.rev) return cached;
  const loaded = await b.load(company);
  if (!loaded) throw new NotFound('없는 회사입니다.');
  const state = tablesToState(loaded.tables as Record<string, Row[]>, defaultSettings());
  const e: Entry = { rev: loaded.rev, state, snap: snapshot(state).snap };
  G.cache.set(company, e);
  return e;
}

function diff(e: Entry) {
  const { tables, snap } = snapshot(e.state);
  const changes: Changes = {};
  let count = 0;
  for (const [t, rows] of Object.entries(tables)) {
    const before = e.snap[t] ?? new Map<string, string>();
    const after = snap[t];
    const put = rows.filter((r) => before.get(String(r.id)) !== after.get(String(r.id)));
    const del = [...before.keys()].filter((id) => !after.has(id));
    if (put.length || del.length) { changes[t] = { put, del }; count += put.length + del.length; }
  }
  return { changes, snap, count };
}

function lock<T>(company: string, fn: () => Promise<T>): Promise<T> {
  const prev = G.locks.get(company) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  G.locks.set(company, next.catch(() => {}));
  return next;
}

export const clock = (s: State) => Date.now() + (s.settings.clockOffsetMin || 0) * 60000;

async function run<T>(company: string, fn: (s: State, now: number) => T, write: boolean): Promise<T> {
  const b = await getBackend();
  return lock(company, async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const e = await entry(b, company);
      let result: T;
      let dirty = write;
      try {
        touch(e.state);
        const now = clock(e.state);
        if (expireRequests(e.state, now)) dirty = true;
        result = fn(e.state, now);
        touch(e.state);
      } catch (err) {
        G.cache.delete(company); // 중간까지 바뀐 메모리 상태는 버린다
        throw err;
      }
      if (!dirty) return result;
      const d = diff(e);
      if (!d.count) return result;
      let rev: number;
      try {
        rev = await b.apply(company, e.rev, d.changes);
      } catch (err) {
        G.cache.delete(company);
        throw err;
      }
      if (rev < 0) { G.cache.delete(company); continue; } // 다른 서버가 먼저 저장 → 최신으로 다시
      e.rev = rev;
      e.snap = d.snap;
      return result;
    }
    throw new StoreError('동시에 여러 곳에서 저장하고 있습니다. 잠시 뒤 다시 시도해 주세요.');
  });
}

/** 읽기 전용(fn 안에서 상태를 바꾸지 않는다) */
export const read = <T>(company: string, fn: (s: State, now: number) => T) => run(company, fn, false);
/** 상태를 바꾸고 바뀐 행만 저장한다 */
export const mutate = <T>(company: string, fn: (s: State, now: number) => T) => run(company, fn, true);

export async function getCompany(code: string): Promise<CompanyRow | null> {
  return (await getBackend()).getCompany(code);
}

export async function currentRev(code: string) {
  const b = await getBackend();
  const c = await b.getCompany(code);
  if (!c) throw new NotFound('없는 회사입니다.');
  // 만료할 요청이 남아 있으면 처리해 버전을 올린다.
  const cached = G.cache.get(code);
  if (cached && cached.rev === c.rev && cached.state.requests.some((r) => r.status === 'sent' && Date.parse(r.expiresAt) <= clock(cached.state))) {
    await read(code, () => null);
    return (await b.getCompany(code))?.rev ?? c.rev;
  }
  return c.rev;
}

/** 모든 회사의 기한 지난 요청을 만료시킨다(1분마다, 또는 /api/cron). */
export async function expireAll() {
  const b = await getBackend();
  const list = await b.listCompanies();
  for (const c of list) await read(c.code, () => null);
  return list.length;
}

/**
 * 체험 회사를 처음 상태(배치 없음)로 되돌린다.
 * 실제 회사(새한 프라텍)에 근무자가 등록돼 있으면 그 공장 구조를 그대로 쓰고 이름만 가상으로 바꾼다.
 * 아직 없으면 내장 예시 데이터를 쓴다.
 */
export async function resetDemo(company: string) {
  const c = await getCompany(company);
  if (!c?.demo) throw new StoreError('체험 회사에서만 쓸 수 있습니다.');
  const real = await read(DEFAULT_COMPANY, (s) => (s.people.some((p) => p.active) ? virtualize(s) : null)).catch(() => null);
  await mutate(company, (s) => {
    const fresh = real ?? seedDemo(today());
    pinDemoClock(fresh, Date.now());
    stageDemoPlan(fresh, today());
    Object.assign(s, fresh);
  });
}

/** 새 회사 등록(scripts/company.ts) */
export async function createCompany(code: string, name: string, adminPassword: string) {
  const b = await getBackend();
  await seedCompany(b, code, name, false, seedStructure(emptyState(), today()));
  await b.putAccount({ company: code, kind: 'admin', loginId: 'admin', pwHash: await hashPassword(adminPassword), fails: 0, lockedUntil: 0 });
}
