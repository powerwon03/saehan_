// 교대 달력. 2025년 현장 데이터 기준 12일 주기 3조 2교대:
// 주간 4일 → 휴무 2일 → 야간 4일 → 휴무 2일. 공장마다 기준일이 따로 있다.
import type { Crew, Factory, Settings, Shift } from './types';
import { diffDays, dow } from './dates';

export const ROTATING: Crew[] = ['A', 'B', 'C'];

/** 그 조가 그날 원래 서는 교대. 쉬는 날이면 null */
export function crewShift(settings: Settings, factory: Factory, crew: Crew, date: string): Shift | null {
  if (crew === 'DAY') {
    const w = dow(date);
    return w >= 1 && w <= 5 ? 'day' : null;
  }
  const pat = settings.cyclePattern;
  const len = pat.length;
  if (!len) return null;
  const off = settings.crewOffsets[crew] ?? 0;
  const pos = (((diffDays(date, factory.anchorDate) - off) % len) + len) % len;
  const ch = pat[pos];
  return ch === 'D' ? 'day' : ch === 'N' ? 'night' : null;
}

/** 그날 그 교대를 서는 교대조(A·B·C 중) */
export function crewsOn(settings: Settings, factory: Factory, date: string, shift: Shift): Crew[] {
  return ROTATING.filter((c) => crewShift(settings, factory, c, date) === shift);
}

export function validPattern(p: string) {
  return /^[DNO]+$/.test(p) && p.includes('D') && p.includes('N');
}
