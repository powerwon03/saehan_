import { describe, expect, it } from 'vitest';
import { crewShift, crewsOn } from '@/lib/calendar';
import { addDays, dow, seoulMs, weekStart } from '@/lib/dates';
import {
  boardId, cannotWorkExtra, ix, needs, planAssign, recommend, skillOf, standbyPeople, weekHours,
} from '@/lib/engine';
import { autoAssign, placeManual, setPlan, FlowError } from '@/lib/flows';
import { seedDemo } from '@/lib/seed';

// 2025-04-28(월): 1공장 A조 주간 · B조 야간 · C조 휴무(주간 4일을 마친 뒤 둘째 휴무일)
const D = '2025-04-28';
const NOW = seoulMs(D, '06:00');

describe('교대 달력 (12일 주기 3조 2교대)', () => {
  const s = seedDemo();
  const [f1, f2] = s.factories;

  it('주간 4 → 휴무 2 → 야간 4 → 휴무 2', () => {
    const seq = Array.from({ length: 12 }, (_, i) => crewShift(s.settings, f1, 'A', addDays('2025-04-27', i)));
    expect(seq).toEqual(['day', 'day', 'day', 'day', null, null, 'night', 'night', 'night', 'night', null, null]);
  });

  it('매일 주간 1개 조 + 야간 1개 조 + 휴무 1개 조', () => {
    for (let i = 0; i < 40; i++) {
      const d = addDays('2026-01-01', i);
      for (const f of [f1, f2]) {
        expect(crewsOn(s.settings, f, d, 'day')).toHaveLength(1);
        expect(crewsOn(s.settings, f, d, 'night')).toHaveLength(1);
      }
    }
  });

  it('2공장은 1공장보다 하루 늦게 돈다', () => {
    for (let i = 0; i < 24; i++) {
      const d = addDays('2025-06-01', i);
      expect(crewShift(s.settings, f2, 'A', addDays(d, 1))).toBe(crewShift(s.settings, f1, 'A', d));
    }
  });

  it('주간조는 평일 주간만 근무한다', () => {
    for (let i = 0; i < 14; i++) {
      const d = addDays(D, i);
      const w = dow(d);
      expect(crewShift(s.settings, f1, 'DAY', d)).toBe(w >= 1 && w <= 5 ? 'day' : null);
    }
  });
});

describe('필요 인원 계산', () => {
  it('기본(원터치 라인 데모와 같은 값): 1공장 야간 20명·주간 23명, 2공장 주간 14명', () => {
    const s = seedDemo();
    const sum = (f: string, shift: 'day' | 'night') => needs(s, f, D, shift).reduce((n, r) => n + r.need, 0);
    // 야간: L-8 쉼 → 라인 14 + 고정 5 + 운반 추가 1
    expect(sum('f1', 'night')).toBe(20);
    // 주간: 라인 16 + L-2 화장품 용기(표준 3명) 1 + 고정 5 + 운반 추가 1
    expect(sum('f1', 'day')).toBe(23);
    expect(sum('f2', 'day')).toBe(14);
  });

  it('그날 계획이 없으면 가장 최근 계획을 이어 쓴다', () => {
    const s = seedDemo();
    setPlan(s, { date: addDays(D, -3), shift: 'day', postId: 'f1-L1', productId: 'pr-sauce300', status: 'run' });
    const row = needs(s, 'f1', D, 'day').find((r) => r.post.id === 'f1-L1')!;
    expect(row.productId).toBe('pr-sauce300');
    expect(row.inherited).toBe(true);
    // 야간 계획은 따로다
    expect(needs(s, 'f1', D, 'night').find((r) => r.post.id === 'f1-L1')!.productId).toBe('pr-mak750');
  });

  it('쉼 라인은 0명, 표준 인원표(라인 × 제품)가 기본 인원보다 우선', () => {
    const s = seedDemo();
    setPlan(s, { date: D, shift: 'day', postId: 'f1-L3', productId: null, status: 'off' });
    setPlan(s, { date: D, shift: 'day', postId: 'f1-L1', productId: 'pr-det1l', status: 'run' });
    const rows = needs(s, 'f1', D, 'day');
    expect(rows.find((r) => r.post.id === 'f1-L3')!.need).toBe(0);
    expect(rows.find((r) => r.post.id === 'f1-L1')!.need).toBe(3);
    // L-2 화장품 용기 150ml 는 여성 3명 조건
    expect(rows.find((r) => r.post.id === 'f1-L2')).toMatchObject({ need: 3, gender: 'F' });
  });

  it('가동 라인이 6개 미만이면 운반 추가가 없고, 하나도 없으면 고정 자리도 0명', () => {
    const s = seedDemo();
    for (const i of [1, 2, 3]) setPlan(s, { date: D, shift: 'day', postId: `f1-L${i}`, productId: null, status: 'off' });
    expect(needs(s, 'f1', D, 'day').find((r) => r.post.role === '운반')!.need).toBe(1);
    for (const i of [4, 5, 6, 7, 8]) setPlan(s, { date: D, shift: 'day', postId: `f1-L${i}`, productId: null, status: 'off' });
    expect(needs(s, 'f1', D, 'day').reduce((n, r) => n + r.need, 0)).toBe(0);
  });

  it('무인 라인은 가동이어도 0명', () => {
    const s = seedDemo();
    expect(needs(s, 'f2', D, 'day').find((r) => r.post.id === 'f2-P1')!.need).toBe(0);
  });
});

describe('근무할 수 있는지 판단', () => {
  const s = seedDemo();
  const a = s.people.find((p) => p.factoryId === 'f1' && p.crew === 'A' && p.role === '검사원')!;

  it('야간 다음 날 주간 금지', () => {
    // A조: 2025-05-03~06 야간, 05-07·08 휴무
    expect(cannotWorkExtra(s, a, '2025-05-07', 'day')).toBe('after-night');
    expect(cannotWorkExtra(s, a, '2025-05-07', 'night')).toBeNull();
  });

  it('오늘 야간 뒤 내일 주간이 잡혀 있으면 금지', () => {
    // 05-09부터 다시 주간
    expect(cannotWorkExtra(s, a, '2025-05-08', 'night')).toBe('before-day');
    expect(cannotWorkExtra(s, a, '2025-05-08', 'day')).toBeNull();
  });

  it('같은 날 이미 근무하면 금지', () => {
    expect(cannotWorkExtra(s, a, D, 'night')).toBe('same-day');
  });

  it('주 근로시간 = 그 주 교대 수 × 8시간, 52시간을 넘기면 금지', () => {
    const h = weekHours(s, a, '2025-05-07');
    const start = weekStart('2025-05-07');
    let n = 0;
    for (let i = 0; i < 7; i++) if (crewShift(s.settings, s.factories[0], 'A', addDays(start, i))) n++;
    expect(h).toBe(n * 8);
    s.settings.maxWeekHours = h; // 한 번 더 나오면 넘는다
    expect(cannotWorkExtra(s, a, '2025-05-07', 'night')).toBe('hours');
    s.settings.maxWeekHours = 52;
  });
});

describe('숙련도', () => {
  const s = seedDemo();
  const post = s.posts.find((p) => p.id === 'f1-L1')!;
  const p = s.people.find((x) => x.role === '검사원' && x.factoryId === 'f1')!;

  it('근무 이력 0회 → 0, 1회 이상 → 1, 10회 이상 → 2, 30회 이상 → 3', () => {
    for (const [n, want] of [[0, 0], [1, 1], [9, 1], [10, 2], [29, 2], [30, 3]] as const) {
      p.experience = { [post.id]: n };
      p.skills = {};
      expect(skillOf(s, p, post)).toBe(want);
    }
  });

  it('관리자가 직접 고친 값이 우선', () => {
    p.experience = { [post.id]: 40 };
    p.skills = { [post.id]: 1 };
    expect(skillOf(s, p, post)).toBe(1);
  });

  it('고정 자리: 지정된 사람 3, 같은 역할 2, 그 외 0', () => {
    const carry = s.posts.find((x) => x.id === 'f1-MV')!;
    const eq = s.posts.find((x) => x.id === 'f1-EQ')!;
    const named = s.people.find((x) => x.fixedPostId === 'f1-EQ')!;
    const same = s.people.find((x) => x.factoryId === 'f1' && x.role === '운반')!;
    const other = s.people.find((x) => x.factoryId === 'f1' && x.role === '반장')!;
    for (const x of [named, same, other]) x.skills = {};
    expect(skillOf(s, named, eq)).toBe(3);
    expect(skillOf(s, same, carry)).toBe(2);
    expect(skillOf(s, other, carry)).toBe(0);
  });
});

describe('자동 배치', () => {
  it('주간: 23자리를 모두 채우고 1명이 대기, 야간: 20자리를 채우고 4명이 대기(24명 출근)', () => {
    const s = seedDemo();
    const r = autoAssign(s, 'f1', D, 'day', NOW);
    expect(r.placed).toBe(23);
    expect(r.vacancies).toBe(0);
    expect(standbyPeople(s, 'f1', D, 'day')).toHaveLength(1);
    // 그 교대 정규 근무자만 들어간다
    for (const a of s.assignments) {
      const p = ix(s).person.get(a.personId)!;
      expect(p.factoryId).toBe('f1');
      expect(p.crew).toBe('A');
    }
    // 여성 조건이 걸린 L-2 에는 여성만 들어간다
    for (const a of s.assignments.filter((x) => x.postId === 'f1-L2')) expect(ix(s).person.get(a.personId)!.gender).toBe('F');

    const n = autoAssign(s, 'f1', D, 'night', NOW);
    expect(n.placed).toBe(20);
    expect(standbyPeople(s, 'f1', D, 'night')).toHaveLength(4);
  });

  it('고정 자리는 지정된 사람이 먼저 들어간다', () => {
    const s = seedDemo();
    autoAssign(s, 'f1', D, 'night', NOW);
    for (const a of s.assignments) {
      const post = ix(s).post.get(a.postId)!;
      if (post.kind !== 'fixed') continue;
      expect(ix(s).person.get(a.personId)!.role).toBe(post.role);
    }
    expect(s.assignments.filter((a) => a.flags.includes('role'))).toHaveLength(0);
  });

  it('한 사람이 같은 날 두 자리에 들어가지 못한다', () => {
    const s = seedDemo();
    autoAssign(s, 'f1', D, 'day', NOW);
    const seen = new Set(s.assignments.map((a) => a.personId));
    expect(seen.size).toBe(s.assignments.length);
    const someone = s.assignments[0].personId;
    expect(() => placeManual(s, { factoryId: 'f2', date: D, shift: 'day', postId: 'f2-S1', personId: someone }, NOW)).toThrow(FlowError);
    expect(() => placeManual(s, { factoryId: 'f1', date: D, shift: 'night', postId: 'f1-L1', personId: someone }, NOW)).toThrow(FlowError);
  });

  it('결과는 같은 입력에 항상 같다(동점이면 id 순)', () => {
    const a = planAssign(seedDemo(), 'f1', D, 'day', NOW).add.map((x) => `${x.postId}:${x.personId}`);
    const b = planAssign(seedDemo(), 'f1', D, 'day', NOW).add.map((x) => `${x.postId}:${x.personId}`);
    expect(a).toEqual(b);
  });

  it('계획이 바뀌면 바뀐 라인만 다시 채우고, 직접 고친 자리는 그대로 둔다', () => {
    const s = seedDemo();
    autoAssign(s, 'f1', D, 'night', NOW);
    // 대기 인원 한 명을 L-3에 직접 넣는다(잠금) — L-3은 3명이 된다
    const sb = standbyPeople(s, 'f1', D, 'night')[0];
    const manual = placeManual(s, { factoryId: 'f1', date: D, shift: 'night', postId: 'f1-L3', personId: sb.id }, NOW);
    expect(manual.locked).toBe(true);
    const before = new Map(s.assignments.map((a) => [a.id, a.postId]));

    // L-1 제품을 세제 1L로 바꿔 필요 인원 2 → 3
    setPlan(s, { date: D, shift: 'night', postId: 'f1-L1', productId: 'pr-det1l', status: 'run' });
    const r = autoAssign(s, 'f1', D, 'night', NOW);
    expect(r.placed).toBe(1);
    const added = s.assignments.filter((a) => !before.has(a.id));
    expect(added.map((a) => a.postId)).toEqual(['f1-L1']);
    // 잠긴 자리는 남고, L-3에서 넘치는 1명(잠기지 않은 사람)만 빠진다
    expect(s.assignments.some((a) => a.id === manual.id)).toBe(true);
    expect(r.removed).toBe(1);
    expect(s.assignments.filter((a) => a.postId === 'f1-L3')).toHaveLength(2);
  });

  it('쉼으로 바꾼 라인의 사람은 다시 자동 배치하면 빠진다', () => {
    const s = seedDemo();
    autoAssign(s, 'f1', D, 'night', NOW);
    setPlan(s, { date: D, shift: 'night', postId: 'f1-L7', productId: null, status: 'off' });
    autoAssign(s, 'f1', D, 'night', NOW);
    expect(s.assignments.filter((a) => a.postId === 'f1-L7')).toHaveLength(0);
    expect(ix(s).asgBoard.get(boardId(D, 'night', 'f1'))).toHaveLength(18);
  });
});

describe('대체 인력 추천 순서', () => {
  const s = seedDemo();
  autoAssign(s, 'f1', D, 'day', NOW);
  const list = recommend(s, { factoryId: 'f1', date: D, shift: 'day', postId: 'f1-L4' });

  it('후보 = 그 교대 대기 인원 + 쉬는 사람, 이미 배치된 사람은 없다', () => {
    expect(list.length).toBeGreaterThan(10);
    const assigned = new Set(s.assignments.map((a) => a.personId));
    expect(list.some((c) => assigned.has(c.personId))).toBe(false);
    expect(list.filter((c) => c.type === 'standby')).toHaveLength(1);
  });

  it('① 쉬는 사람 → ② 같은 공장 → ③ 이번 달 실 근무일수가 적은 사람 순으로 앞 기준이 항상 이긴다', () => {
    const key = (c: (typeof list)[number]) =>
      (c.type === 'off' ? 10000 : 0) + (ix(s).person.get(c.personId)!.factoryId === 'f1' ? 1000 : 0) + (40 - c.monthDays);
    for (let i = 1; i < list.length; i++) expect(key(list[i - 1])).toBeGreaterThanOrEqual(key(list[i]));
    expect(list[0].type).toBe('off');
  });

  it('다른 공장 사람은 근거에 공장 이름이 붙는다', () => {
    const other = list.find((c) => ix(s).person.get(c.personId)!.factoryId === 'f2');
    expect(other?.reasons).toContain('2공장');
  });

  it('야간 직후 휴무인 사람은 주간 후보에서 빠진다', () => {
    // 2025-05-07: 1공장 A조가 야간 4일을 막 끝낸 첫 휴무일
    const s2 = seedDemo();
    const l2 = recommend(s2, { factoryId: 'f1', date: '2025-05-07', shift: 'day', postId: 'f1-L2' });
    const aCrew = new Set(s2.people.filter((p) => p.factoryId === 'f1' && p.crew === 'A').map((p) => p.id));
    expect(l2.some((c) => aCrew.has(c.personId))).toBe(false);
  });
});
