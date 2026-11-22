import { api, getSession, HttpError } from '@/server/session';
import { currentRev } from '@/server/store';

/** 데이터 버전 번호만. 화면이 4초마다 확인해 바뀌면 다시 받는다. */
export async function GET() {
  return api(async () => {
    const s = await getSession();
    if (!s) throw new HttpError(401, '로그인이 필요합니다.');
    return { rev: await currentRev(s.c) };
  });
}
