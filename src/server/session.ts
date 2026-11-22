// 세션: HMAC으로 서명한 httpOnly 쿠키(30일). 쿠키에 회사 코드가 들어 있어 서버는 그 회사 데이터만 읽고 쓴다.
import crypto from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { FlowError } from '@/lib/flows';
import { getBackend, NotFound, read } from './store';
import { StoreError } from './backend';

const COOKIE = 'sp_session';
const MAX_AGE = 30 * 24 * 3600;

export interface Session {
  c: string;
  r: 'admin' | 'worker';
  id: string;
  exp: number;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

let cachedSecret: string | null = null;
async function secret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (cachedSecret) return cachedSecret;
  const b = await getBackend();
  let v = await b.getMeta('session_secret');
  if (!v) {
    v = crypto.randomBytes(32).toString('base64url');
    await b.setMeta('session_secret', v);
    v = (await b.getMeta('session_secret')) ?? v;
  }
  cachedSecret = v;
  return v;
}

const sign = (body: string, key: string) => crypto.createHmac('sha256', key).update(body).digest('base64url');

export async function encodeSession(s: Omit<Session, 'exp'>) {
  const body = Buffer.from(JSON.stringify({ ...s, exp: Math.floor(Date.now() / 1000) + MAX_AGE })).toString('base64url');
  return `${body}.${sign(body, await secret())}`;
}

export async function decodeSession(token: string | undefined): Promise<Session | null> {
  if (!token) return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const want = sign(body, await secret());
  const a = Buffer.from(mac), b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Session;
    if (!s.c || !s.id || (s.r !== 'admin' && s.r !== 'worker') || s.exp < Date.now() / 1000) return null;
    return s;
  } catch {
    return null;
  }
}

export async function startSession(s: Omit<Session, 'exp'>) {
  (await cookies()).set(COOKIE, await encodeSession(s), {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: MAX_AGE,
  });
}

export async function endSession() {
  (await cookies()).delete(COOKIE);
}

export async function getSession() {
  return decodeSession((await cookies()).get(COOKIE)?.value);
}

export async function requireAdmin() {
  const s = await getSession();
  if (!s || s.r !== 'admin') throw new HttpError(401, '관리자 로그인이 필요합니다.');
  return s;
}

/** 재직 중인 근무자인지 매번 확인한다. */
export async function requireWorker() {
  const s = await getSession();
  if (!s || s.r !== 'worker') throw new HttpError(401, '로그인이 필요합니다.');
  const ok = await read(s.c, (st) => st.people.some((p) => p.id === s.id && p.active));
  if (!ok) throw new HttpError(401, '로그인이 필요합니다.');
  return s;
}

/** 다른 사이트에서 보낸 요청(CSRF)을 막는다. */
async function sameOrigin() {
  const h = await headers();
  const origin = h.get('origin');
  if (!origin) return;
  let host = '';
  try { host = new URL(origin).host; } catch { /* 잘못된 origin */ }
  if (host !== (h.get('x-forwarded-host') ?? h.get('host'))) throw new HttpError(403, '허용되지 않은 요청입니다.');
}

/** API 공통 처리: 오류를 상태 코드와 한국어 문구로 바꾼다. */
export async function api(fn: () => Promise<unknown>, post = false) {
  try {
    if (post) await sameOrigin();
    const data = await fn();
    return NextResponse.json(data ?? { ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof FlowError) return NextResponse.json({ error: e.message }, { status: 400 });
    if (e instanceof NotFound) return NextResponse.json({ error: e.message }, { status: 404 });
    if (e instanceof StoreError) return NextResponse.json({ error: e.message }, { status: 503 });
    console.error(e);
    return NextResponse.json({ error: '서버 오류가 났습니다.' }, { status: 500 });
  }
}

export async function body(req: Request): Promise<Record<string, unknown>> {
  try {
    const j = await req.json();
    return j && typeof j === 'object' ? (j as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
