// 로그인: 관리자 = 아이디 + 비밀번호, 근무자 = 사번 + 개인 비밀번호(처음에는 전화번호 뒤 4자리).
// 5번 틀리면 10분 잠긴다.
import { getBackend, read } from './store';
import { hashPassword, safeEqual, verifyPassword } from './password';
import type { AccountRow } from './backend';

const MAX_FAILS = 5;
const LOCK_MS = 10 * 60000;

export type LoginResult = { ok: true; id: string } | { ok: false; error: 'invalid' | 'locked'; minutes?: number };

async function attempt(a: AccountRow, check: () => Promise<boolean>): Promise<LoginResult> {
  const b = await getBackend();
  const now = Date.now();
  if (a.lockedUntil > now) return { ok: false, error: 'locked', minutes: Math.ceil((a.lockedUntil - now) / 60000) };
  if (await check()) {
    if (a.fails || a.lockedUntil) await b.putAccount({ ...a, fails: 0, lockedUntil: 0 });
    return { ok: true, id: a.loginId };
  }
  const fails = a.fails + 1;
  if (fails >= MAX_FAILS) {
    await b.putAccount({ ...a, fails: 0, lockedUntil: now + LOCK_MS });
    return { ok: false, error: 'locked', minutes: LOCK_MS / 60000 };
  }
  await b.putAccount({ ...a, fails });
  return { ok: false, error: 'invalid' };
}

export async function loginAdmin(company: string, loginId: string, password: string): Promise<LoginResult> {
  const b = await getBackend();
  const a = await b.getAccount(company, 'admin', loginId);
  if (!a || !a.pwHash) return { ok: false, error: 'invalid' };
  const hash = a.pwHash;
  return attempt(a, () => verifyPassword(password, hash));
}

export async function loginWorker(company: string, empNo: string, password: string): Promise<LoginResult> {
  const p = await read(company, (s) => {
    const x = s.people.find((q) => q.active && q.empNo.toLowerCase() === empNo.trim().toLowerCase());
    return x ? { id: x.id, phone: x.phone } : null;
  });
  if (!p) return { ok: false, error: 'invalid' };
  const b = await getBackend();
  const a = (await b.getAccount(company, 'worker', p.id))
    ?? { company, kind: 'worker' as const, loginId: p.id, pwHash: null, fails: 0, lockedUntil: 0 };
  const last4 = p.phone.replace(/\D/g, '').slice(-4);
  return attempt(a, async () => {
    if (a.pwHash) return verifyPassword(password, a.pwHash);
    return last4.length === 4 && safeEqual(password, last4); // 개인 비밀번호를 정하기 전
  });
}

export async function setPassword(company: string, kind: 'admin' | 'worker', loginId: string, password: string) {
  const b = await getBackend();
  await b.putAccount({ company, kind, loginId, pwHash: await hashPassword(password), fails: 0, lockedUntil: 0 });
}

export async function checkAdminPassword(company: string, loginId: string, password: string) {
  const a = await (await getBackend()).getAccount(company, 'admin', loginId);
  return !!a?.pwHash && verifyPassword(password, a.pwHash);
}

/** 잠금 풀기 + 비밀번호를 전화번호 뒤 4자리로 되돌리기 */
export async function resetWorker(company: string, personId: string) {
  await (await getBackend()).deleteAccount(company, 'worker', personId);
}

/** 지금 로그인이 잠긴 근무자 id 목록 */
export async function lockedWorkers(company: string) {
  const now = Date.now();
  return (await (await getBackend()).listAccounts(company, 'worker')).filter((a) => a.lockedUntil > now).map((a) => a.loginId);
}
