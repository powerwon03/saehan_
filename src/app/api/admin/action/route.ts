import { api, body, HttpError, requireAdmin } from '@/server/session';
import { getCompany, mutate, resetDemo } from '@/server/store';
import { checkAdminPassword, resetWorker, setPassword } from '@/server/accounts';
import { adminAction } from '@/server/actions';
import { pinDemoClock } from '@/lib/demo';

export async function POST(req: Request) {
  return api(async () => {
    const s = await requireAdmin();
    const a = await body(req);
    switch (a.type) {
      // 계정과 체험 기능은 회사 데이터 밖의 일이라 따로 처리한다.
      case 'unlock':
        await resetWorker(s.c, String(a.personId ?? ''));
        return { ok: true };
      case 'adminPassword': {
        const next = String(a.next ?? '');
        if (next.length < 8) throw new HttpError(400, '새 비밀번호는 8자 이상이어야 합니다.');
        if (!(await checkAdminPassword(s.c, s.id, String(a.current ?? '')))) throw new HttpError(400, '지금 비밀번호가 맞지 않습니다.');
        await setPassword(s.c, 'admin', s.id, next);
        return { ok: true };
      }
      case 'demoReset':
        await resetDemo(s.c);
        return { ok: true };
      case 'demoClock': {
        if (!(await getCompany(s.c))?.demo) throw new HttpError(400, '체험 회사에서만 쓸 수 있습니다.');
        await mutate(s.c, (st) => {
          st.settings.clockOffsetMin = 24 * 60; // 일부러 어긋나게 한 뒤 교대 시작 1시간 전으로 맞춘다
          pinDemoClock(st, Date.now());
        });
        return { ok: true };
      }
      default:
        return (await mutate(s.c, (st, now) => adminAction(st, now, a))) ?? { ok: true };
    }
  }, true);
}
