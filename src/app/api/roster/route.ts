import { api, HttpError } from '@/server/session';
import { DEMO_COMPANY, demoEnabled, getCompany, mutate } from '@/server/store';
import { rosterView } from '@/server/views';
import { pinDemoClock } from '@/lib/demo';

/** 체험 첫 화면: 명단(전화번호 없음) + 오늘 체험 배역. 실제 회사 명단은 내주지 않는다. */
export async function GET() {
  return api(async () => {
    const c = demoEnabled() ? await getCompany(DEMO_COMPANY) : null;
    if (!c?.demo) throw new HttpError(404, '체험 기능이 꺼져 있습니다.');
    return mutate(DEMO_COMPANY, (s) => {
      pinDemoClock(s, Date.now());
      return rosterView(s, Date.now() + s.settings.clockOffsetMin * 60000);
    });
  });
}
