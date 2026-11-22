import { api, HttpError } from '@/server/session';
import { expireAll } from '@/server/store';

/**
 * 요청 만료 예약 작업. 서버리스(Vercel)처럼 서버가 계속 떠 있지 않은 곳에서는
 * 예약 작업(Vercel Cron 등)이 1분마다 이 주소를 부른다. CRON_SECRET 이 있으면 Bearer 로 확인한다.
 */
export async function GET(req: Request) {
  return api(async () => {
    const secret = process.env.CRON_SECRET;
    if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) throw new HttpError(401, '인증이 필요합니다.');
    return { companies: await expireAll() };
  });
}
