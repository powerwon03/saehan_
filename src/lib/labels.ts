import type { AbsenceKind, Crew, Shift } from './types';

export const SHIFT_LABEL: Record<Shift, string> = { day: '주간', night: '야간' };
export const KIND_LABEL: Record<AbsenceKind, string> = {
  absent: '결근', sick: '병가', early: '조퇴', late: '지각', leave: '휴무',
};
export const KIND_SHORT: Record<AbsenceKind, string> = { absent: '결', sick: '병', early: '조', late: '지', leave: '휴' };
/** 조 이름. 화면에는 「A조」, 주간조는 「주간」으로 적는다 */
export const CREW_LABEL: Record<Crew, string> = { A: 'A조', B: 'B조', C: 'C조', DAY: '주간' };
export const CREW_SHORT: Record<Crew, string> = { A: 'A', B: 'B', C: 'C', DAY: '주간' };
export const LANG_LABEL: Record<string, string> = { ko: '한국어', en: 'English', mn: '몽골어', vi: '베트남어' };
export const REPORTER_LABEL: Record<string, string> = { self: '본인', leader: '반장', support: '지원팀' };
/** 라인에 서는 사람의 역할 */
export const LINE_ROLE = '검사원';
export const ROLES = [LINE_ROLE, '운반', 'OP', 'BOX', '반장', '설비관리', '생산관리'];
export const FLAG_LABEL: Record<string, string> = {
  'no-exp': '이 자리 경험 없음', 'low-skill': '숙련도 낮음', role: '역할이 다름', gender: '성별 조건이 다름', hours: '이번 주 44시간 이상',
};
export const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
/** 숙련도 0~3 */
export const SKILL_NAME = ['없음', '보조 필요', '단독 가능', '숙련 · 지도 가능'];
export const SKILL_SHORT = ['-', '초급', '중급', '숙련'];
/** 11/22 */
export const md = (d: string) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
