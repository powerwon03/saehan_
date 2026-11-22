import { describe, expect, it } from 'vitest';
import { addDays, seoul, seoulMs } from '@/lib/dates';
import { ix, recommend, standbyPeople } from '@/lib/engine';
import {
  autoAssign, cancelAbsence, confirmBoard, decideLeave, expireRequests, placeForAbsence, replaceAssignment,
  reportAbsence, requestLeave, respondRequest, sendRequests,
} from '@/lib/flows';
import { pickDemoCast, pinDemoClock } from '@/lib/demo';
import { seedDemo } from '@/lib/seed';
import type { State } from '@/lib/types';

const D = '2025-04-28';
const NOW = seoulMs(D, '06:00');
const MIN = 60000;

/** 야간(대기 인원 없음)을 배치·확정하고 라인 근무자 한 명을 고른다 */
function setup() {
  const s = seedDemo();
  autoAssign(s, 'f1', D, 'night', NOW);
  confirmBoard(s, 'f1', D, 'night', NOW);
  const victim = s.assignments.find((a) => a.postId === 'f1-L2')!;
  return { s, victim };
}
const offTop = (s: State, postId: string, n = 3) =>
  recommend(s, { factoryId: 'f1', date: D, shift: 'night', postId }).filter((c) => c.type === 'off').slice(0, n).map((c) => c.personId);

describe('결근 처리 흐름', () => {
  it('신고하면 배치가 지워지고 빈자리가 된다(decided), 관리자 알림이 기록된다', () => {
    const { s, victim } = setup();
    const ab = reportAbsence(s, { personId: victim.personId, date: D, shift: 'night', kind: 'absent', reportedBy: 'self' }, NOW)!;
    expect(ab.status).toBe('decided');
    expect(ab.postId).toBe('f1-L2');
    expect(s.assignments.some((a) => a.personId === victim.personId)).toBe(false);
    expect(s.messages.some((m) => m.personId === null && m.body.includes('결근 신고'))).toBe(true);
  });

  it('같은 사람·날짜 중복 신고는 무시', () => {
    const { s, victim } = setup();
    const o = { personId: victim.personId, date: D, shift: 'night' as const, kind: 'absent' as const, reportedBy: 'self' as const };
    expect(reportAbsence(s, o, NOW)).not.toBeNull();
    expect(reportAbsence(s, o, NOW)).toBeNull();
    expect(s.absences).toHaveLength(1);
  });

  it('자리가 없던 대기 인원의 결근은 기록만(not-needed)', () => {
    const s = seedDemo();
    autoAssign(s, 'f1', D, 'day', NOW);
    const sb = standbyPeople(s, 'f1', D, 'day')[0];
    const ab = reportAbsence(s, { personId: sb.id, date: D, shift: 'day', kind: 'sick', reportedBy: 'support' }, NOW)!;
    expect(ab.status).toBe('not-needed');
  });

  it('배치 전 결근은 자동 배치 때 반영된다', () => {
    const s = seedDemo();
    const p = s.people.find((x) => x.factoryId === 'f1' && x.crew === 'B' && x.role === '검사원')!;
    const ab = reportAbsence(s, { personId: p.id, date: D, shift: 'night', kind: 'absent', reportedBy: 'self' }, NOW)!;
    expect(ab.status).toBe('pre-board');
    const r = autoAssign(s, 'f1', D, 'night', NOW);
    expect(s.assignments.some((a) => a.personId === p.id)).toBe(false);
    expect(r.vacancies).toBe(0); // 야간은 대기 인원이 있어 빈자리가 생기지 않는다
    expect(ab.status).toBe('not-needed');
  });

  it('요청 → 먼저 수락한 1명만 확정, 나머지는 취소되고 「다른 분이 가기로 했습니다」', () => {
    const { s, victim } = setup();
    const ab = reportAbsence(s, { personId: victim.personId, date: D, shift: 'night', kind: 'absent', reportedBy: 'self' }, NOW)!;
    const [a, b, c] = offTop(s, 'f1-L2');
    expect(sendRequests(s, ab.id, [a, b, c], NOW + MIN)).toBe(3);
    expect(ab.status).toBe('in-progress');
    const req = (pid: string) => s.requests.find((r) => r.personId === pid)!;
    expect(Date.parse(req(a).expiresAt) - Date.parse(req(a).sentAt)).toBe(20 * MIN);

    expect(respondRequest(s, req(b).id, b, true, NOW + 3 * MIN)).toBe('accepted');
    expect(ab.status).toBe('resolved');
    expect(ab.resolvedPersonId).toBe(b);
    const placed = s.assignments.find((x) => x.personId === b)!;
    expect(placed).toMatchObject({ postId: 'f1-L2', source: 'sub', locked: true, date: D, shift: 'night' });
    expect(req(a).status).toBe('cancelled');
    expect(req(c).status).toBe('cancelled');
    expect(s.messages.filter((m) => m.body === '다른 분이 가기로 했습니다').map((m) => m.personId).sort()).toEqual([a, c].sort());
    expect(s.messages.some((m) => m.body.includes('투입 완료 · 3분 만에 해결'))).toBe(true);

    // 늦게 수락한 사람에게도 같은 문구
    expect(respondRequest(s, req(a).id, a, true, NOW + 4 * MIN)).toBe('taken');
    expect(s.assignments.filter((x) => x.postId === 'f1-L2')).toHaveLength(2);
  });

  it('확정된 배치표에 대체로 들어가면 근무 이력이 쌓인다', () => {
    const { s, victim } = setup();
    const ab = reportAbsence(s, { personId: victim.personId, date: D, shift: 'night', kind: 'absent', reportedBy: 'self' }, NOW)!;
    const [a] = offTop(s, 'f1-L2', 1);
    const p = ix(s).person.get(a)!;
    const before = p.experience['f1-L2'] ?? 0;
    sendRequests(s, ab.id, [a], NOW);
    respondRequest(s, s.requests[0].id, a, true, NOW + MIN);
    expect(p.experience['f1-L2']).toBe(before + 1);
    expect(p.lastPostId).toBe('f1-L2');
  });

  it('모두 거절하면 결근 카드가 다시 추천 목록으로 돌아간다', () => {
    const { s, victim } = setup();
    const ab = reportAbsence(s, { personId: victim.personId, date: D, shift: 'night', kind: 'absent', reportedBy: 'self' }, NOW)!;
    const [a, b] = offTop(s, 'f1-L2', 2);
    sendRequests(s, ab.id, [a, b], NOW);
    for (const r of [...s.requests]) expect(respondRequest(s, r.id, r.personId, false, NOW + MIN)).toBe('declined');
    expect(ab.status).toBe('decided');
  });

  it('20분 무응답이면 만료되고 추천 목록으로 돌아간다', () => {
    const { s, victim } = setup();
    const ab = reportAbsence(s, { personId: victim.personId, date: D, shift: 'night', kind: 'absent', reportedBy: 'self' }, NOW)!;
    const [a] = offTop(s, 'f1-L2', 1);
    sendRequests(s, ab.id, [a], NOW);
    expect(expireRequests(s, NOW + 19 * MIN)).toBe(false);
    expect(expireRequests(s, NOW + 20 * MIN)).toBe(true);
    expect(s.requests[0].status).toBe('expired');
    expect(ab.status).toBe('decided');
    expect(respondRequest(s, s.requests[0].id, a, true, NOW + 21 * MIN)).toBe('expired');
  });

  it('신고 취소: 해결 전이면 요청을 지우고 원래 배치를 되돌린다', () => {
    const { s, victim } = setup();
    const ab = reportAbsence(s, { personId: victim.personId, date: D, shift: 'night', kind: 'absent', reportedBy: 'self' }, NOW)!;
    sendRequests(s, ab.id, offTop(s, 'f1-L2', 2), NOW);
    expect(cancelAbsence(s, ab.id, NOW + MIN)).toBe(true);
    expect(s.absences).toHaveLength(0);
    expect(s.requests).toHaveLength(0);
    expect(s.assignments.find((a) => a.personId === victim.personId)?.postId).toBe('f1-L2');
  });

  it('해결된 뒤에는 신고를 취소할 수 없다', () => {
    const { s, victim } = setup();
    const ab = reportAbsence(s, { personId: victim.personId, date: D, shift: 'night', kind: 'absent', reportedBy: 'self' }, NOW)!;
    placeForAbsence(s, ab.id, offTop(s, 'f1-L2', 1)[0], NOW + MIN);
    expect(ab.status).toBe('resolved');
    expect(() => cancelAbsence(s, ab.id, NOW + 2 * MIN)).toThrow();
  });

  it('대기 인원 「바로 배치」는 이동(move)으로 들어가고 요청 중이던 사람은 취소된다', () => {
    const s = seedDemo();
    autoAssign(s, 'f1', D, 'day', NOW);
    const victim = s.assignments.find((a) => a.postId === 'f1-L4')!;
    const ab = reportAbsence(s, { personId: victim.personId, date: D, shift: 'day', kind: 'absent', reportedBy: 'leader' }, NOW)!;
    const off = recommend(s, { factoryId: 'f1', date: D, shift: 'day', postId: 'f1-L4' }).find((c) => c.type === 'off')!;
    sendRequests(s, ab.id, [off.personId], NOW);
    const sb = standbyPeople(s, 'f1', D, 'day')[0];
    placeForAbsence(s, ab.id, sb.id, NOW + MIN);
    expect(s.assignments.find((a) => a.personId === sb.id)).toMatchObject({ source: 'move', locked: true });
    expect(s.requests[0].status).toBe('cancelled');
  });
});

describe('직접 고치기', () => {
  it('다른 자리 사람을 고르면 두 사람을 맞바꾸고 둘 다 잠긴다', () => {
    const { s } = setup();
    const x = s.assignments.find((a) => a.postId === 'f1-L1')!;
    const y = s.assignments.find((a) => a.postId === 'f1-L5')!;
    const [px, py] = [x.personId, y.personId];
    replaceAssignment(s, x.id, py, NOW);
    expect(s.assignments.find((a) => a.personId === py)).toMatchObject({ postId: 'f1-L1', locked: true });
    expect(s.assignments.find((a) => a.personId === px)).toMatchObject({ postId: 'f1-L5', locked: true });
    expect(s.assignments).toHaveLength(20);
  });
});

describe('휴무', () => {
  it('승인하면 그날 근무일인 경우 결근 처리로 이어지고, 같은 날 중복 신청은 무시', () => {
    const s = seedDemo();
    const p = s.people.find((x) => x.factoryId === 'f1' && x.crew === 'A' && x.role === '검사원')!;
    const day = addDays(D, 1); // A조 주간
    const l = requestLeave(s, p.id, day, NOW)!;
    expect(requestLeave(s, p.id, day, NOW)).toBeNull();
    decideLeave(s, l.id, true, NOW);
    expect(l.status).toBe('approved');
    const ab = s.absences.find((a) => a.personId === p.id && a.date === day)!;
    expect(ab).toMatchObject({ kind: 'leave', status: 'pre-board', shift: 'day' });
    autoAssign(s, 'f1', day, 'day', NOW);
    expect(s.assignments.some((a) => a.personId === p.id)).toBe(false);
  });

  it('이미 배치된 날의 휴무를 승인하면 빈자리가 되고 대체 추천이 뜬다', () => {
    const { s, victim } = setup();
    const l = requestLeave(s, victim.personId, D, NOW)!;
    decideLeave(s, l.id, true, NOW);
    expect(s.absences[0]).toMatchObject({ kind: 'leave', status: 'decided', postId: 'f1-L2' });
    expect(offTop(s, 'f1-L2').length).toBeGreaterThan(0);
  });

  it('반려하면 끝', () => {
    const s = seedDemo();
    const p = s.people[10];
    const l = requestLeave(s, p.id, addDays(D, 2), NOW)!;
    decideLeave(s, l.id, false, NOW);
    expect(l.status).toBe('rejected');
    expect(s.absences).toHaveLength(0);
  });
});

describe('시연 12일 연속 흐름(교대 주기 한 바퀴)', () => {
  it('매일 배역이 정해지고, 초기화 없이도 자동 배치 → 확정 → 결근 → 요청 → 수락이 끝까지 된다', () => {
    const s = seedDemo();
    const shifts = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const date = addDays('2026-11-22', i);
      const real = seoulMs(date, '14:00');
      pinDemoClock(s, real); // 낮에 열어도 교대 시작 1시간 전으로 맞춰진다
      const now = real + s.settings.clockOffsetMin * MIN;
      expect(seoul(now)).toEqual({ date, time: '06:00' });

      const cast = pickDemoCast(s, now);
      expect(cast.worker1, `${date} 오늘 근무`).toBeTruthy();
      expect(cast.offWorkers.length, `${date} 오늘 휴무`).toBeGreaterThanOrEqual(1);
      shifts.add(cast.shift);

      autoAssign(s, cast.factoryId, date, cast.shift, now);
      confirmBoard(s, cast.factoryId, date, cast.shift, now);
      const mine = s.assignments.find((a) => a.personId === cast.worker1 && a.date === date)!;
      expect(mine, `${date} worker1이 배치표에 든다`).toBeTruthy();

      const ab = reportAbsence(s, { personId: cast.worker1!, date, shift: cast.shift, kind: 'absent', reportedBy: 'self' }, now)!;
      expect(ab.status).toBe('decided');
      const top3 = recommend(s, { factoryId: cast.factoryId, date, shift: cast.shift, postId: ab.postId! }).slice(0, 3).map((c) => c.personId);
      for (const w of cast.offWorkers) expect(top3, `${date} 휴무 배역이 추천 앞 3명 안에 있다`).toContain(w);
      // 결근이 생긴 뒤에도 같은 배역이 나온다
      expect(pickDemoCast(s, now)).toMatchObject({ worker1: cast.worker1, shift: cast.shift });

      expect(sendRequests(s, ab.id, cast.offWorkers, now + MIN)).toBe(cast.offWorkers.length);
      const r = s.requests.find((x) => x.absenceId === ab.id && x.personId === cast.offWorkers[0])!;
      expect(respondRequest(s, r.id, r.personId, true, now + 2 * MIN)).toBe('accepted');
      expect(ab.status).toBe('resolved');
    }
    // 쉬는 조가 막 야간을 끝낸 날은 야간으로 시연한다
    expect(shifts.has('day')).toBe(true);
  });
});
