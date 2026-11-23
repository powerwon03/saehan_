// 날짜는 모두 'YYYY-MM-DD' 문자열, 시각은 서울 시간(UTC+9, 서머타임 없음)으로 다룬다.

const DAY = 86400000;
const KST = 9 * 3600000;

export const toMs = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
export const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => fromMs(toMs(d) + n * DAY);
export const diffDays = (a: string, b: string) => Math.round((toMs(a) - toMs(b)) / DAY);
/** 0 = 일요일 */
export const dow = (d: string) => new Date(toMs(d)).getUTCDay();
/** 그 주 월요일 */
export const weekStart = (d: string) => addDays(d, -((dow(d) + 6) % 7));
export const monthOf = (d: string) => d.slice(0, 7);

/**
 * 생산계획의 한 주: 금요일 야간에 시작해 다음 금요일 주간에 끝난다(목요일 임시 → 금요일 확정).
 * 그 교대가 속한 주의 시작 금요일을 돌려준다.
 */
export function planWeekOf(date: string, shift: 'day' | 'night') {
  const back = (dow(date) + 2) % 7; // 금 0, 토 1, … 목 6
  return back === 0 && shift === 'day' ? addDays(date, -7) : addDays(date, -back);
}

/** 그 주의 교대 14개: 금 야간, 토 주간, 토 야간, …, 목 야간, 다음 금 주간 */
export function planWeekShifts(friday: string): { date: string; shift: 'day' | 'night' }[] {
  const out: { date: string; shift: 'day' | 'night' }[] = [{ date: friday, shift: 'night' }];
  for (let i = 1; i <= 6; i++) out.push({ date: addDays(friday, i), shift: 'day' }, { date: addDays(friday, i), shift: 'night' });
  out.push({ date: addDays(friday, 7), shift: 'day' });
  return out;
}
export const isDate = (d: unknown): d is string =>
  typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && fromMs(toMs(d)) === d;

/** 시각(ms) → 서울 날짜·시각 */
export function seoul(ms: number) {
  const s = new Date(ms + KST).toISOString();
  return { date: s.slice(0, 10), time: s.slice(11, 16) };
}

/** 서울 날짜 + 'HH:MM' → 시각(ms) */
export function seoulMs(date: string, time: string) {
  const [h, m] = time.split(':').map(Number);
  return toMs(date) + (h * 60 + m) * 60000 - KST;
}

export const iso = (ms: number) => new Date(ms).toISOString();

export function daysInMonth(month: string) {
  const y = +month.slice(0, 4), m = +month.slice(5, 7);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

export function addMonths(month: string, n: number) {
  const y = +month.slice(0, 4), m = +month.slice(5, 7) - 1 + n;
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
}
