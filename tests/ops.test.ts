// 현장 운영 방식 반영: 결원 충원 순서(이번 달 근무일수), 제품 → 숙련도 배정, 아웃소싱 인원 요청, 주 단위 생산계획
import { describe, expect, it } from 'vitest';
import { addDays, dow, planWeekOf, planWeekShifts, seoulMs } from '@/lib/dates';
import { effectivePlan, isOut, ix, monthWorkDays, needs, personName, recommend, scheduledShift, score } from '@/lib/engine';
import { autoAssign, confirmBoard, fillOutsource, FlowError, placeOutsource, reportAbsence, replaceAssignment, unassign } from '@/lib/flows';
import { seedDemo, virtualize } from '@/lib/seed';
import { pickDemoCast, stageDemoPlan } from '@/lib/demo';
import { adminAction } from '@/server/actions';
import { alertsView, attendanceView, boardView, defaultBoard, leavesView, outsourceView, planView } from '@/server/views';

// 2025-04-28(월): 1공장 A조 주간 · B조 야간 · C조 휴무
const D = '2025-04-28';
const NOW = seoulMs(D, '07:00');

describe('결원 충원 순서', () => {
  it('쉬는 사람 → 같은 공장 → 이번 달 실 근무일수가 적은 사람 순이다', () => {
    const s = seedDemo();
    autoAssign(s, 'f1', D, 'day', NOW);
    const list = recommend(s, { factoryId: 'f1', date: D, shift: 'day', postId: 'f1-L4' });
    const key = (c: (typeof list)[number]) =>
      (c.type === 'off' ? 10000 : 0) + (ix(s).person.get(c.personId)!.factoryId === 'f1' ? 1000 : 0) + (40 - c.monthDays);
    for (let i = 1; i < list.length; i++) expect(key(list[i - 1])).toBeGreaterThanOrEqual(key(list[i]));
    expect(list[0].type).toBe('off');
    // 근무일수가 같으면 같은 제품 경험이 있는 사람이 앞선다
    const same = list.filter((c) => key(c) === key(list[0]));
    const firstWithout = same.findIndex((c) => !c.reasons.includes('product'));
    if (firstWithout >= 0) expect(same.slice(firstWithout).some((c) => c.reasons.includes('product'))).toBe(false);
  });

  it('이번 달에 하루 쉰 사람은 근무일수가 줄어 먼저 추천된다', () => {
    const s = seedDemo();
    autoAssign(s, 'f1', D, 'day', NOW);
    const before = recommend(s, { factoryId: 'f1', date: D, shift: 'day', postId: 'f1-L4' }).filter((c) => c.type === 'off');
    const last = before.filter((c) => c.monthDays === before[0].monthDays).pop()!;
    const p = ix(s).person.get(last.personId)!;
    // 이달 초 근무일 하루를 병가로 쉬게 한다
    let day = '2025-04-01';
    while (!scheduledShift(s, p, day)) day = addDays(day, 1);
    const days = monthWorkDays(s, p, D);
    reportAbsence(s, { personId: p.id, date: day, shift: scheduledShift(s, p, day)!, kind: 'sick', reportedBy: 'support' }, NOW);
    expect(monthWorkDays(s, p, D)).toBe(days - 1);
    const after = recommend(s, { factoryId: 'f1', date: D, shift: 'day', postId: 'f1-L4' });
    expect(after[0].personId).toBe(p.id);
    expect(after[0].monthDays).toBe(days - 1);
  });

  it('추천 목록에 전화번호가 함께 나온다(전화로 출근 가능 여부를 확인한다)', () => {
    const s = seedDemo();
    autoAssign(s, 'f1', D, 'day', NOW);
    const list = recommend(s, { factoryId: 'f1', date: D, shift: 'day', postId: 'f1-L4' });
    expect(list.every((c) => c.phone === ix(s).person.get(c.personId)!.phone)).toBe(true);
    expect(list[0].phone).toMatch(/^010-/);
  });
});

describe('라인 배정은 생산 제품 → 숙련도 순', () => {
  it('그 제품을 해 본 사람이 숙련도만 높은 사람보다 앞선다', () => {
    const s = seedDemo();
    const row = needs(s, 'f1', D, 'day').find((r) => r.post.id === 'f1-L4')!;
    expect(row.productId).toBeTruthy();
    const [a, b] = s.people.filter((p) => p.factoryId === 'f1' && p.crew === 'A' && p.role === '검사원');
    for (const p of [a, b]) { p.experience = {}; p.productExperience = {}; p.lastPostId = null; }
    a.skills = { 'f1-L4': 1 };
    a.productExperience = { [row.productId!]: 3 };
    b.skills = { 'f1-L4': 3 };
    expect(score(s, a, row, D, false)).toBeGreaterThan(score(s, b, row, D, false));
    // 제품 경험이 같으면 숙련도가 높은 사람
    b.productExperience = { [row.productId!]: 3 };
    expect(score(s, b, row, D, false)).toBeGreaterThan(score(s, a, row, D, false));
  });
});

describe('아웃소싱(일용직) 인원 요청', () => {
  /** 야간을 배치·확정한 뒤 라인 한 자리와 운반 한 자리를 결근으로 비운다 */
  function setup() {
    const s = seedDemo();
    autoAssign(s, 'f1', D, 'night', NOW);
    confirmBoard(s, 'f1', D, 'night', NOW);
    const line = s.assignments.find((a) => a.postId === 'f1-L2')!;
    const carry = s.assignments.find((a) => a.postId === 'f1-MV')!;
    const abLine = reportAbsence(s, { personId: line.personId, date: D, shift: 'night', kind: 'absent', reportedBy: 'leader' }, NOW)!;
    const abCarry = reportAbsence(s, { personId: carry.personId, date: D, shift: 'night', kind: 'absent', reportedBy: 'leader' }, NOW)!;
    return { s, abLine, abCarry, agency: s.settings.agencies[0] };
  }
  const slot = { factoryId: 'f1', date: D, shift: 'night' as const };

  it('검사원 자리는 「업체명-여」, 운반 자리는 「업체명-남」으로 채워지고 결근이 해결된다', () => {
    const { s, abLine, abCarry, agency } = setup();
    const a1 = placeOutsource(s, { ...slot, postId: 'f1-L2', agencyId: agency.id }, NOW);
    const a2 = placeOutsource(s, { ...slot, postId: 'f1-MV', agencyId: agency.id }, NOW);
    expect(isOut(a1.personId)).toBe(true);
    expect(personName(s, a1.personId)).toBe(`${agency.name}-여`);
    expect(personName(s, a2.personId)).toBe(`${agency.name}-남`);
    expect(a1).toMatchObject({ source: 'out', locked: true });
    expect(abLine).toMatchObject({ status: 'resolved', resolvedPersonId: a1.personId });
    expect(abCarry.status).toBe('resolved');
    // 사람 표에는 넣지 않는다
    expect(s.people.some((p) => p.id === a1.personId)).toBe(false);
  });

  it('배치 화면에 업체별 인원과 업체에 보낼 문자 내용이 나온다', () => {
    const { s, agency } = setup();
    placeOutsource(s, { ...slot, postId: 'f1-L2', agencyId: agency.id }, NOW);
    placeOutsource(s, { ...slot, postId: 'f1-MV', agencyId: agency.id }, NOW);
    const v = boardView(s, NOW, slot);
    expect(v.outsourcing).toHaveLength(1);
    expect(v.outsourcing[0]).toMatchObject({ name: agency.name, male: 1, female: 1, total: 2 });
    expect(v.outsourcing[0].text).toBe(
      ['[새한 프라텍] 인원 요청드립니다.', '4/28(월) 야간 20:00~08:00 · 1공장', '운반&박스(남) 1명', '품질검사원(여) 1명', '합계 2명'].join('\n'),
    );
    const chip = v.rows.find((r) => r.postId === 'f1-L2')!.assigned.find((a) => a.out)!;
    expect(chip.name).toBe(`${agency.name}-여`);
    expect(v.rows.find((r) => r.postId === 'f1-L2')!.vacancies).toBe(0);
    expect(v.absences.find((a) => a.postId === 'f1-L2')!.resolvedName).toBe(`${agency.name}-여`);
    // 월 근태표에는 업체별 투입 인원이 따로 나온다
    expect(attendanceView(s, '2025-04').outsourced).toEqual([{ date: D, shift: 'night', factory: '1공장', agency: agency.name, male: 1, female: 1 }]);
    // 「아웃소싱」 메뉴: 그 달의 요청 현황과 업체별 합계
    const o = outsourceView(s, NOW, {});
    expect(o).toMatchObject({ month: '2025-04', total: 2 });
    expect(o.rows).toEqual([{ date: D, shift: 'night', factoryId: 'f1', factory: '1공장', agencyId: agency.id, agency: agency.name, male: 1, female: 1 }]);
    expect(o.agencies.find((a) => a.id === agency.id)).toMatchObject({ name: agency.name, male: 1, female: 1, total: 2 });
    expect(o.agencies.find((a) => a.id !== agency.id)).toMatchObject({ total: 0 });
    expect(outsourceView(s, NOW, { month: '2025-05' })).toMatchObject({ month: '2025-05', total: 0, rows: [] });
  });

  it('남은 빈자리를 한 번에 채우고, 다 찬 자리에는 더 넣지 못한다', () => {
    const { s, agency } = setup();
    expect(fillOutsource(s, { ...slot, agencyId: agency.id }, NOW)).toBe(2);
    expect(fillOutsource(s, { ...slot, agencyId: agency.id }, NOW)).toBe(0);
    expect(() => placeOutsource(s, { ...slot, postId: 'f1-L2', agencyId: agency.id }, NOW)).toThrow(FlowError);
    expect(() => placeOutsource(s, { ...slot, postId: 'f1-L3', agencyId: '없는업체' }, NOW)).toThrow('업체');
  });

  it('다시 자동 배치해도 남고, 직원으로 바꾸거나 자리에서 뺄 수 있다', () => {
    const { s, agency } = setup();
    const a = placeOutsource(s, { ...slot, postId: 'f1-L2', agencyId: agency.id }, NOW);
    autoAssign(s, 'f1', D, 'night', NOW);
    confirmBoard(s, 'f1', D, 'night', NOW);
    expect(s.assignments.some((x) => x.id === a.id)).toBe(true);
    expect(s.messages.some((m) => m.personId === a.personId)).toBe(false);
    const off = recommend(s, { ...slot, postId: 'f1-L3' }).find((c) => c.type === 'off')!;
    replaceAssignment(s, a.id, off.personId, NOW);
    expect(s.assignments.some((x) => isOut(x.personId))).toBe(false);
    expect(s.assignments.some((x) => x.personId === off.personId && x.postId === 'f1-L2')).toBe(true);
    // 그 직원을 빼면 다시 빈자리가 되어 아웃소싱으로 채울 수 있다
    unassign(s, s.assignments.find((x) => x.personId === off.personId)!.id);
    const b = placeOutsource(s, { ...slot, postId: 'f1-L2', agencyId: agency.id }, NOW);
    unassign(s, b.id);
    expect(s.assignments.some((x) => x.id === b.id)).toBe(false);
  });

  it('업체를 등록·수정·삭제할 수 있고, 지워도 배치표에는 「아웃소싱-여」로 남는다', () => {
    const { s } = setup();
    const { id } = adminAction(s, NOW, { type: 'agencySave', name: '새인력', phone: '010-2222-3333' }) as { id: string };
    expect(() => adminAction(s, NOW, { type: 'agencySave', name: '새인력' })).toThrow('이미 있는');
    adminAction(s, NOW, { type: 'agencySave', id, name: '새인력2', phone: '' });
    expect(s.settings.agencies.find((x) => x.id === id)).toMatchObject({ name: '새인력2', phone: '' });
    adminAction(s, NOW, { type: 'placeOutsource', ...slot, postId: 'f1-L2', agencyId: id });
    adminAction(s, NOW, { type: 'agencyDelete', id });
    const out = s.assignments.find((x) => isOut(x.personId))!;
    expect(personName(s, out.personId)).toBe('아웃소싱-여');
  });
});

describe('주 단위 생산계획 (금요일 야간 ~ 다음 금요일 주간)', () => {
  const FRI = '2025-05-02';

  it('한 주는 금요일 야간에 시작해 다음 금요일 주간에 끝나는 교대 14개다', () => {
    expect(dow(FRI)).toBe(5);
    const shifts = planWeekShifts(FRI);
    expect(shifts).toHaveLength(14);
    expect(shifts[0]).toEqual({ date: FRI, shift: 'night' });
    expect(shifts[13]).toEqual({ date: addDays(FRI, 7), shift: 'day' });
    for (const c of shifts) expect(planWeekOf(c.date, c.shift)).toBe(FRI);
    // 금요일 주간은 앞 주, 그 다음 금요일 야간은 다음 주
    expect(planWeekOf(FRI, 'day')).toBe(addDays(FRI, -7));
    expect(planWeekOf(addDays(FRI, 7), 'night')).toBe(addDays(FRI, 7));
  });

  it('칸을 정하면 그 교대부터 주 끝까지 적히고, 필요 인원은 그 라인·제품의 기준으로 기억된다', () => {
    const s = seedDemo();
    const shifts = planWeekShifts(FRI);
    adminAction(s, NOW, { type: 'planCells', postId: 'f1-L1', cells: shifts.slice(2), productId: 'pr-mak750', status: 'run', need: 3 });
    const post = ix(s).post.get('f1-L1')!;
    expect(effectivePlan(s, post, shifts[1].date, shifts[1].shift).productId).not.toBe('pr-mak750');
    for (const c of shifts.slice(2)) expect(effectivePlan(s, post, c.date, c.shift)).toMatchObject({ productId: 'pr-mak750', status: 'run', inherited: false });
    const v = planView(s, NOW, { factoryId: 'f1', week: FRI });
    const line = v.lines.find((l) => l.postId === 'f1-L1')!;
    expect(line.cells[1].set).toBe(false);
    expect(line.cells[2]).toMatchObject({ set: true, product: '막걸리 750ml', need: 3 });
    expect(v.standards['f1-L1|pr-mak750']).toBe(3);
    // 한 교대만 쉼으로 바꾸면 그 교대만 바뀐다
    adminAction(s, NOW, { type: 'planCells', postId: 'f1-L1', cells: [shifts[5]], productId: 'pr-mak750', status: 'off' });
    const v2 = planView(s, NOW, { factoryId: 'f1', week: FRI }).lines.find((l) => l.postId === 'f1-L1')!;
    expect(v2.cells[5]).toMatchObject({ status: 'off', need: 0 });
    expect(v2.cells[6]).toMatchObject({ status: 'run', need: 3 });
  });

  it('목요일에는 임시, 금요일에 확정하면 배치 화면에도 확정으로 보인다', () => {
    const s = seedDemo();
    const board = { factoryId: 'f1', date: addDays(FRI, 1), shift: 'day' as const };
    expect(planView(s, NOW, { factoryId: 'f1', week: FRI }).final).toBe(false);
    expect(boardView(s, NOW, board)).toMatchObject({ planWeek: FRI, planFinal: false });
    adminAction(s, NOW, { type: 'planWeek', factoryId: 'f1', week: FRI, final: true });
    expect(planView(s, NOW, { factoryId: 'f1', week: FRI }).final).toBe(true);
    expect(boardView(s, NOW, board).planFinal).toBe(true);
    // 다른 공장·다른 주는 그대로 임시
    expect(planView(s, NOW, { factoryId: 'f2', week: FRI }).final).toBe(false);
    expect(planView(s, NOW, { factoryId: 'f1', week: addDays(FRI, 7) }).final).toBe(false);
    adminAction(s, NOW, { type: 'planWeek', factoryId: 'f1', week: FRI, final: false });
    expect(planView(s, NOW, { factoryId: 'f1', week: FRI }).final).toBe(false);
    expect(() => adminAction(s, NOW, { type: 'planWeek', factoryId: 'f1', week: addDays(FRI, 1), final: true })).toThrow('금요일');
  });

  it('「지난주와 같게」는 지난주의 같은 요일·교대 계획을 그대로 적는다', () => {
    const s = seedDemo();
    const prev = planWeekShifts(addDays(FRI, -7));
    adminAction(s, NOW, { type: 'planCells', postId: 'f1-L3', cells: [prev[4]], productId: 'pr-det1l', status: 'run' });
    adminAction(s, NOW, { type: 'planCells', postId: 'f1-L3', cells: [prev[6]], productId: 'pr-det1l', status: 'off' });
    adminAction(s, NOW, { type: 'planCopy', factoryId: 'f1', week: FRI });
    const line = planView(s, NOW, { factoryId: 'f1', week: FRI }).lines.find((l) => l.postId === 'f1-L3')!;
    expect(line.cells.every((c) => c.set)).toBe(true);
    expect(line.cells[4]).toMatchObject({ productId: 'pr-det1l', status: 'run' });
    expect(line.cells[6].status).toBe('off');
  });
});

describe('「오늘 못 나와요」 신고 알림 (휴무 승인 메뉴)', () => {
  it('근무자가 누른 신고가 목록과 배지에 뜨고, 대신 설 사람이 정해지면 배지에서 빠진다', () => {
    const s = seedDemo();
    autoAssign(s, 'f1', D, 'night', NOW);
    confirmBoard(s, 'f1', D, 'night', NOW);
    expect(alertsView(s, NOW)).toMatchObject({ total: 0, openReports: 0, reports: [] });
    const mine = s.assignments.find((a) => a.postId === 'f1-L2')!;
    const name = personName(s, mine.personId);
    const ab = reportAbsence(s, { personId: mine.personId, date: D, shift: 'night', kind: 'absent', reportedBy: 'self' }, NOW)!;
    expect(alertsView(s, NOW)).toMatchObject({ total: 1, openReports: 1, reports: [{ id: ab.id, name, factory: '1공장', shift: 'night' }] });
    expect(leavesView(s, NOW).reports[0]).toMatchObject({ name, status: 'decided', open: true, postCode: 'L-2', factoryId: 'f1', date: D, shift: 'night' });
    expect(boardView(s, NOW, { factoryId: 'f1', date: D, shift: 'night' }).pendingLeaves).toBe(1);
    // 관리자가 직접 등록한 결근은 알림 대상이 아니다
    const other = s.assignments.find((a) => a.postId === 'f1-L3')!;
    reportAbsence(s, { personId: other.personId, date: D, shift: 'night', kind: 'sick', reportedBy: 'support' }, NOW);
    expect(alertsView(s, NOW).openReports).toBe(1);
    // 휴무 신청 대기와 합쳐서 배지에 보인다
    const off = recommend(s, { factoryId: 'f1', date: D, shift: 'night', postId: 'f1-L2' }).find((c) => c.type === 'off')!;
    adminAction(s, NOW, { type: 'placeAbsence', absenceId: ab.id, personId: off.personId });
    expect(alertsView(s, NOW)).toMatchObject({ total: 0, openReports: 0 });
    expect(leavesView(s, NOW).reports[0]).toMatchObject({ status: 'resolved', open: false, resolvedName: off.name });
  });

  it('이틀 넘게 지난 신고는 목록에서 빠진다', () => {
    const s = seedDemo();
    autoAssign(s, 'f1', D, 'night', NOW);
    const mine = s.assignments.find((a) => a.postId === 'f1-L2')!;
    reportAbsence(s, { personId: mine.personId, date: D, shift: 'night', kind: 'absent', reportedBy: 'self' }, NOW);
    expect(leavesView(s, seoulMs(addDays(D, 1), '09:00')).reports).toHaveLength(1);
    expect(leavesView(s, seoulMs(addDays(D, 2), '09:00')).reports).toHaveLength(0);
  });
});

describe('시연 준비(체험 회사)', () => {
  it('이번 주 생산계획은 직접 적고 확정한 상태, 다음 주는 임시로 남는다', () => {
    const s = seedDemo('2025-05-06');
    const before = planView(s, seoulMs('2025-05-06', '07:00'), { factoryId: 'f1' });
    expect(before.week).toBe('2025-05-02');
    stageDemoPlan(s, '2025-05-06');
    const now = seoulMs('2025-05-06', '07:00');
    const week = planView(s, now, { factoryId: 'f1' });
    expect(week.final).toBe(true);
    expect(week.lines.every((l) => l.cells.every((c) => c.set))).toBe(true);
    // 값은 준비 전과 같다(이어받던 계획을 그대로 적었을 뿐)
    expect(week.lines.map((l) => l.cells.map((c) => [c.productId, c.status]))).toEqual(before.lines.map((l) => l.cells.map((c) => [c.productId, c.status])));
    expect(planView(s, now, { factoryId: 'f2' }).final).toBe(true);
    const next = planView(s, now, { factoryId: 'f1', week: '2025-05-09' });
    expect(next.final).toBe(false);
    expect(next.lines.some((l) => l.cells.some((c) => c.set))).toBe(false);
    // 두 번 해도 칸이 겹치지 않는다
    const n = s.plan.length;
    stageDemoPlan(s, '2025-05-06');
    expect(s.plan).toHaveLength(n);
    expect(new Set(s.plan.map((c) => c.id)).size).toBe(n);
  });

  it('금요일에는 주간이 속한 주와 야간이 속한 주를 모두 준비한다', () => {
    const s = seedDemo('2025-05-09');
    stageDemoPlan(s, '2025-05-09');
    expect(Object.keys(s.settings.planWeeks).sort()).toEqual(['f1|2025-05-02', 'f1|2025-05-09', 'f2|2025-05-02', 'f2|2025-05-09']);
  });

  it('체험 근무자 일부는 네팔어 화면을 쓰고, 쉬는 사람 배역은 네팔어 사용자를 먼저 고른다', () => {
    const demo = virtualize(seedDemo());
    const ne = demo.people.filter((p) => p.lang === 'ne');
    expect(ne.length).toBeGreaterThanOrEqual(4);
    expect(ne.every((p) => p.role === '검사원')).toBe(true);
    expect(new Set(demo.people.map((p) => p.name)).size).toBe(demo.people.length);
    const cast = pickDemoCast(demo, NOW);
    expect(cast.worker1).toBeTruthy();
    expect(cast.offWorkers.length).toBeGreaterThanOrEqual(1);
  });
});

describe('배치 화면', () => {
  it('필요 인원을 바꾸면 라인은 그 제품의 기준으로, 고정 자리는 기본 인원으로 기억한다', () => {
    const s = seedDemo();
    const row = () => needs(s, 'f1', D, 'day');
    const l4 = row().find((r) => r.post.id === 'f1-L4')!;
    adminAction(s, NOW, { type: 'needSet', postId: 'f1-L4', productId: l4.productId, need: 0 });
    expect(row().find((r) => r.post.id === 'f1-L4')!.need).toBe(0); // 옆 라인 담당자가 함께 본다
    adminAction(s, NOW, { type: 'needSet', postId: 'f1-L4', productId: l4.productId, need: 3 });
    expect(row().find((r) => r.post.id === 'f1-L4')!.need).toBe(3);
    expect(s.standards.filter((x) => x.postId === 'f1-L4' && x.productId === l4.productId)).toHaveLength(1);
    adminAction(s, NOW, { type: 'needSet', postId: 'f1-MV', need: 3 });
    expect(ix(s).post.get('f1-MV')!.defaultNeed).toBe(3);
  });

  it('근무시간은 주간 08:00~20:00 · 야간 20:00~08:00, 배치표가 나가는 17시부터 야간 배치를 보여 준다', () => {
    const s = seedDemo();
    expect(boardView(s, NOW, { factoryId: 'f1', date: D, shift: 'day' }).times).toEqual({ start: '08:00', end: '20:00' });
    expect(boardView(s, NOW, { factoryId: 'f1', date: D, shift: 'night' }).times).toEqual({ start: '20:00', end: '08:00' });
    expect(defaultBoard(s, seoulMs(D, '04:59'))).toEqual({ date: addDays(D, -1), shift: 'night' });
    expect(defaultBoard(s, seoulMs(D, '05:00'))).toEqual({ date: D, shift: 'day' });
    expect(defaultBoard(s, seoulMs(D, '16:59'))).toEqual({ date: D, shift: 'day' });
    expect(defaultBoard(s, seoulMs(D, '17:00'))).toEqual({ date: D, shift: 'night' });
  });
});
