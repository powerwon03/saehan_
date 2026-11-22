import { api, body, HttpError, requireWorker } from '@/server/session';
import { getCompany, mutate, read } from '@/server/store';
import { setPassword } from '@/server/accounts';
import { workerAction } from '@/server/actions';
import { workerView } from '@/server/views';

/** 근무자: 본인 데이터만 받는다. */
export async function GET() {
  return api(async () => {
    const s = await requireWorker();
    const v = await read(s.c, (st, now) => workerView(st, now, s.id));
    if (!v) throw new HttpError(401, '로그인이 필요합니다.');
    return v;
  });
}

/** 근무자: 허용된 동작만 보낸다(결근 신고·취소, 요청 응답, 휴무 신청·취소, 언어). */
export async function POST(req: Request) {
  return api(async () => {
    const s = await requireWorker();
    const a = await body(req);
    if (a.type === 'password') {
      // 개인 비밀번호(숫자 4~8자리). 체험 회사에는 비밀번호가 없다.
      const next = String(a.next ?? '');
      if (!/^\d{4,8}$/.test(next) || (await getCompany(s.c))?.demo) throw new HttpError(400, '숫자 4~8자리로 정하세요.');
      await setPassword(s.c, 'worker', s.id, next);
      return { result: 'ok' };
    }
    return mutate(s.c, (st, now) => ({
      result: (workerAction(st, now, s.id, a) as { result?: string } | undefined)?.result ?? 'ok',
      view: workerView(st, now, s.id),
    }));
  }, true);
}
