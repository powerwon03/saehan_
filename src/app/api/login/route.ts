import { api, body, HttpError, startSession } from '@/server/session';
import { loginAdmin, loginWorker } from '@/server/accounts';
import { DEFAULT_COMPANY, getCompany } from '@/server/store';

const BAD = '아이디 또는 비밀번호가 올바르지 않습니다.';

export async function POST(req: Request) {
  return api(async () => {
    const b = await body(req);
    const company = String(b.company || DEFAULT_COMPANY);
    const role = b.role === 'admin' ? 'admin' : 'worker';
    const id = String(b.id ?? '').trim();
    const password = String(b.password ?? '');
    if (!id || !password) throw new HttpError(400, '아이디와 비밀번호를 입력하세요.');
    const c = await getCompany(company);
    if (!c || c.demo) throw new HttpError(401, BAD); // 체험 회사는 비밀번호 로그인이 없다
    const r = role === 'admin' ? await loginAdmin(company, id, password) : await loginWorker(company, id, password);
    if (!r.ok) {
      if (r.error === 'locked') throw new HttpError(429, `여러 번 틀려 잠겼습니다. ${r.minutes}분 뒤에 다시 시도하세요.`);
      throw new HttpError(401, BAD);
    }
    await startSession({ c: company, r: role, id: r.id });
    return { ok: true, role };
  }, true);
}
