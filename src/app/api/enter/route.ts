import { api, body, HttpError, startSession } from '@/server/session';
import { DEMO_COMPANY, demoEnabled, getCompany, read } from '@/server/store';

/** 체험 회사에만 비밀번호 없이 들어간다. 실제 회사에는 쓸 수 없다. */
export async function POST(req: Request) {
  return api(async () => {
    const c = demoEnabled() ? await getCompany(DEMO_COMPANY) : null;
    if (!c?.demo) throw new HttpError(404, '체험 기능이 꺼져 있습니다.');
    const b = await body(req);
    if (b.role === 'admin') {
      await startSession({ c: DEMO_COMPANY, r: 'admin', id: 'admin' });
      return { ok: true, role: 'admin' };
    }
    const id = String(b.id ?? '');
    const ok = await read(DEMO_COMPANY, (s) => s.people.some((p) => p.id === id && p.active));
    if (!ok) throw new HttpError(400, '없는 근무자입니다.');
    await startSession({ c: DEMO_COMPANY, r: 'worker', id });
    return { ok: true, role: 'worker' };
  }, true);
}
