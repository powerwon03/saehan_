import { api, HttpError, requireAdmin } from '@/server/session';
import { read } from '@/server/store';
import { lockedWorkers } from '@/server/accounts';
import { alertsView, attendanceView, boardView, leavesView, masterView, peopleView, planView, slotView } from '@/server/views';
import { isDate } from '@/lib/dates';

export async function GET(req: Request, ctx: { params: Promise<{ view: string }> }) {
  return api(async () => {
    const s = await requireAdmin();
    const { view } = await ctx.params;
    const q = new URL(req.url).searchParams;
    const g = (k: string) => q.get(k) ?? undefined;
    switch (view) {
      case 'board':
        return read(s.c, (st, now) => boardView(st, now, { factoryId: g('factory'), date: g('date'), shift: g('shift') }));
      case 'slot': {
        const shift = g('shift');
        const date = g('date');
        if ((shift !== 'day' && shift !== 'night') || !isDate(date)) throw new HttpError(400, '잘못된 요청입니다.');
        return read(s.c, (st) => slotView(st, { factoryId: g('factory') ?? '', date, shift, postId: g('post') ?? '' }));
      }
      case 'people': {
        const locked = await lockedWorkers(s.c);
        return read(s.c, (st, now) => peopleView(st, locked, now));
      }
      case 'alerts':
        return read(s.c, (st, now) => alertsView(st, now));
      case 'leaves':
        return read(s.c, (st, now) => leavesView(st, now));
      case 'plan':
        return read(s.c, (st, now) => planView(st, now, { factoryId: g('factory'), week: g('week') }));
      case 'master':
        return read(s.c, (st, now) => masterView(st, now));
      case 'attendance': {
        const month = g('month') ?? '';
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new HttpError(400, '월을 확인하세요.');
        return read(s.c, (st) => attendanceView(st, month));
      }
      default:
        throw new HttpError(404, '없는 화면입니다.');
    }
  });
}
