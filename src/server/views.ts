// 화면에 내려 주는 데이터(읽기 전용). 근무자에게는 본인 데이터만 준다.
import type { Person, Shift, State } from '@/lib/types';
import {
  boardId, dutyOn, ix, needs, recommend, scheduledShift, standbyPeople, weekHours,
} from '@/lib/engine';
import { crewsOn } from '@/lib/calendar';
import { addDays, addMonths, daysInMonth, isDate, monthOf, seoul, seoulMs } from '@/lib/dates';
import { KIND_SHORT } from '@/lib/labels';
import { pickDemoCast } from '@/lib/demo';

const asShift = (v: unknown): Shift | null => (v === 'day' || v === 'night' ? v : null);

function shiftTimes(s: State, shift: Shift) {
  return shift === 'day'
    ? { start: s.settings.dayStart, end: s.settings.nightStart }
    : { start: s.settings.nightStart, end: s.settings.dayStart };
}

export const shiftStartMs = (s: State, date: string, shift: Shift) =>
  seoulMs(date, shift === 'day' ? s.settings.dayStart : s.settings.nightStart);

/** 관리자가 지금 볼 교대: 곧 시작하거나 진행 중인 교대 */
export function defaultBoard(s: State, now: number): { date: string; shift: Shift } {
  const { date } = seoul(now);
  const prep = 2 * 3600000;
  if (now < shiftStartMs(s, date, 'day') - prep) return { date: addDays(date, -1), shift: 'night' };
  if (now < shiftStartMs(s, date, 'night') - prep) return { date, shift: 'day' };
  return { date, shift: 'night' };
}

// ───────────── 관리자: 배치 화면 ─────────────

export function boardView(s: State, now: number, q: { factoryId?: string; date?: string; shift?: string }) {
  const I = ix(s);
  const def = defaultBoard(s, now);
  const factoryId = q.factoryId && I.factory.has(q.factoryId) ? q.factoryId : s.factories[0]?.id ?? '';
  const date = isDate(q.date) ? q.date : def.date;
  const shift = asShift(q.shift) ?? def.shift;
  const factory = I.factory.get(factoryId);
  const bid = boardId(date, shift, factoryId);
  const asg = I.asgBoard.get(bid) ?? [];
  const name = (id: string | null) => (id ? I.person.get(id)?.name ?? '(삭제됨)' : '');

  const rows = needs(s, factoryId, date, shift).map((r) => {
    const here = asg.filter((a) => a.postId === r.post.id).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    return {
      postId: r.post.id, code: r.post.code, name: r.post.name, kind: r.post.kind, role: r.post.role,
      unmanned: r.post.unmanned, productId: r.productId, status: r.status, inherited: r.inherited, need: r.need,
      assigned: here.map((a) => {
        const p = I.person.get(a.personId);
        return {
          id: a.id, personId: a.personId, name: p?.name ?? '(삭제됨)', empNo: p?.empNo ?? '', crew: p?.crew ?? '',
          role: p?.role ?? '', source: a.source, locked: a.locked, flags: a.flags, reason: a.reason,
          guest: p && p.factoryId !== factoryId ? I.factory.get(p.factoryId)?.name ?? '' : '',
        };
      }),
      vacancies: Math.max(0, r.need - here.length),
    };
  });
  const standby = standbyPeople(s, factoryId, date, shift).map((p) => ({ personId: p.id, name: p.name, empNo: p.empNo, role: p.role, crew: p.crew }));
  const need = rows.reduce((n, r) => n + r.need, 0);
  const present = asg.length + standby.length;

  const absences = s.absences
    .filter((a) => a.date === date && a.shift === shift && a.factoryId === factoryId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map((a) => {
      const post = a.postId ? I.post.get(a.postId) : null;
      const open = (a.status === 'decided' || a.status === 'in-progress') && !!a.postId;
      return {
        id: a.id, personId: a.personId, name: name(a.personId), postId: a.postId, postCode: post?.code ?? '', postName: post?.name ?? '',
        kind: a.kind, reportedBy: a.reportedBy, status: a.status, createdAt: a.createdAt, resolvedAt: a.resolvedAt,
        resolvedName: name(a.resolvedPersonId),
        minutes: a.resolvedAt ? Math.max(0, Math.round((Date.parse(a.resolvedAt) - Date.parse(a.createdAt)) / 60000)) : null,
        requests: s.requests.filter((r) => r.absenceId === a.id).map((r) => ({
          id: r.id, personId: r.personId, name: name(r.personId), status: r.status, expiresAt: r.expiresAt,
        })),
        candidates: open ? recommend(s, { factoryId, date, shift, postId: a.postId! }) : [],
      };
    });

  return {
    factories: s.factories.map((f) => ({ id: f.id, name: f.name })),
    factoryId, date, shift,
    today: seoul(now).date,
    nowIso: new Date(now).toISOString(),
    clock: seoul(now).time,
    times: shiftTimes(s, shift),
    crews: factory ? crewsOn(s.settings, factory, date, shift) : [],
    status: I.board.get(bid)?.status ?? 'draft',
    hasAssignments: asg.length > 0,
    summary: { need, present, diff: present - need },
    rows, standby, absences,
    products: s.products.filter((p) => p.active).map((p) => ({ id: p.id, code: p.code, name: p.name, urgent: p.urgent })),
    pendingLeaves: s.leaves.filter((l) => l.status === 'pending').length,
    messages: s.messages.filter((m) => m.personId === null).slice(-15).reverse().map((m) => ({ id: m.id, body: m.body, at: m.at })),
  };
}

/** 빈자리를 눌렀을 때: 추천 목록 + 오늘 출근한 사람 */
export function slotView(s: State, q: { factoryId: string; date: string; shift: Shift; postId: string }) {
  const I = ix(s);
  const asg = I.asgBoard.get(boardId(q.date, q.shift, q.factoryId)) ?? [];
  return {
    candidates: recommend(s, q),
    present: [
      ...asg.filter((a) => a.postId !== q.postId).map((a) => {
        const p = I.person.get(a.personId);
        return { personId: a.personId, name: p?.name ?? '', empNo: p?.empNo ?? '', at: I.post.get(a.postId)?.code ?? '' };
      }),
      ...standbyPeople(s, q.factoryId, q.date, q.shift).map((p) => ({ personId: p.id, name: p.name, empNo: p.empNo, at: '대기' })),
    ].sort((a, b) => a.name.localeCompare(b.name, 'ko')),
  };
}

// ───────────── 관리자: 그 밖의 메뉴 ─────────────

export function peopleView(s: State, locked: string[], now: number) {
  const nums = s.people.map((p) => parseInt(p.empNo.replace(/\D/g, ''), 10)).filter((n) => !isNaN(n));
  const prefix = s.people[0]?.empNo.replace(/\d+$/, '') ?? '';
  return {
    people: s.people.slice().sort((a, b) => a.empNo.localeCompare(b.empNo)),
    factories: s.factories.map((f) => ({ id: f.id, name: f.name })),
    posts: s.posts.filter((p) => p.active).sort((a, b) => a.sort - b.sort)
      .map((p) => ({ id: p.id, factoryId: p.factoryId, code: p.code, name: p.name, kind: p.kind, role: p.role, unmanned: p.unmanned })),
    locked,
    nextEmpNo: `${prefix}${(nums.length ? Math.max(...nums) : 240000) + 1}`,
    today: seoul(now).date,
  };
}

export function leavesView(s: State, now: number) {
  const I = ix(s);
  const today = seoul(now).date;
  const order = { pending: 0, approved: 1, rejected: 2 };
  return {
    today,
    leaves: s.leaves
      .filter((l) => l.status === 'pending' || l.date >= addDays(today, -30))
      .map((l) => {
        const p = I.person.get(l.personId);
        return {
          id: l.id, date: l.date, status: l.status, createdAt: l.createdAt,
          name: p?.name ?? '(삭제됨)', empNo: p?.empNo ?? '', crew: p?.crew ?? '',
          factory: p ? I.factory.get(p.factoryId)?.name ?? '' : '',
          shift: p ? (I.asgPD.get(`${p.id}|${l.date}`)?.[0]?.shift ?? scheduledShift(s, p, l.date)) : null,
        };
      })
      .sort((a, b) => order[a.status] - order[b.status] || (a.date < b.date ? -1 : 1)),
  };
}

export function masterView(s: State, now: number) {
  const today = seoul(now).date;
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i));
  return {
    today,
    factories: s.factories,
    posts: s.posts.slice().sort((a, b) => a.sort - b.sort),
    products: s.products,
    standards: s.standards,
    settings: s.settings,
    calendar: s.factories.map((f) => ({
      factoryId: f.id, name: f.name,
      days: days.map((d) => ({ date: d, day: crewsOn(s.settings, f, d, 'day'), night: crewsOn(s.settings, f, d, 'night') })),
    })),
  };
}

/** 월 근태표: 사람 × 날짜. 주 = 주간, 야 = 야간, (대) = 대체 근무, 결·병·조·지·휴 = 빠진 날 */
export function attendanceView(s: State, month: string) {
  const I = ix(s);
  const days = daysInMonth(month);
  const rows = s.people.slice().sort((a, b) => a.empNo.localeCompare(b.empNo)).map((p) => {
    let work = 0, night = 0, sub = 0, missed = 0;
    const cells = days.map((d) => {
      const a = I.asgPD.get(`${p.id}|${d}`)?.[0];
      if (a) {
        work++;
        if (a.shift === 'night') night++;
        if (a.source === 'sub') sub++;
        return (a.shift === 'day' ? '주' : '야') + (a.source === 'sub' ? '(대)' : '');
      }
      const ab = I.absPD.get(`${p.id}|${d}`);
      if (ab) { missed++; return KIND_SHORT[ab.kind]; }
      return '';
    });
    return {
      empNo: p.empNo, name: p.name, factory: I.factory.get(p.factoryId)?.name ?? '', crew: p.crew, active: p.active,
      cells, work, night, sub, missed, hours: work * s.settings.shiftHours,
    };
  }).filter((r) => r.active || r.work || r.missed);
  return { month, days, rows };
}

// ───────────── 근무자: 본인 데이터만 ─────────────

/** 지금 이 사람에게 해당하는 근무(새벽에는 어젯밤 야간이 아직 진행 중일 수 있다) */
export function currentDuty(s: State, p: Person, now: number): { date: string; shift: Shift | null } {
  const I = ix(s);
  const { date: today } = seoul(now);
  const yesterday = addDays(today, -1);
  if (now < shiftStartMs(s, today, 'day')) {
    const ab = I.absPD.get(`${p.id}|${yesterday}`);
    if (ab ? ab.shift === 'night' : dutyOn(s, p, yesterday) === 'night') return { date: yesterday, shift: 'night' };
  }
  const ab = I.absPD.get(`${p.id}|${today}`);
  return { date: today, shift: ab ? ab.shift : dutyOn(s, p, today) };
}

export function workerView(s: State, now: number, personId: string) {
  const I = ix(s);
  const p = I.person.get(personId);
  if (!p) return null;
  const { date: todayDate } = seoul(now);
  const { date, shift } = currentDuty(s, p, now);
  const abs = I.absPD.get(`${p.id}|${date}`);
  const asg = I.asgPD.get(`${p.id}|${date}`)?.[0];
  const factoryId = asg?.factoryId ?? abs?.factoryId ?? p.factoryId;
  const confirmed = shift ? I.board.get(boardId(date, shift, factoryId))?.status === 'confirmed' : false;
  const post = asg ? I.post.get(asg.postId) : null;
  const place = (fid: string, postId: string | null) => {
    const po = postId ? I.post.get(postId) : null;
    return { factoryId: fid, factory: I.factory.get(fid)?.name ?? '', code: po?.code ?? '', name: po?.name ?? '' };
  };

  const req = s.requests
    .filter((r) => r.personId === p.id && r.status === 'sent' && Date.parse(r.expiresAt) > now)
    .map((r) => ({ r, ab: s.absences.find((a) => a.id === r.absenceId) }))
    .filter((x) => x.ab)
    .sort((a, b) => (a.r.sentAt < b.r.sentAt ? -1 : 1))[0];

  // 내가 요청을 받았는데 다른 분이 먼저 가기로 한 경우(최근 30분)
  const taken = s.requests.find((r) => {
    if (r.personId !== p.id || r.status !== 'cancelled') return false;
    const a = s.absences.find((x) => x.id === r.absenceId);
    return !!a && a.status === 'resolved' && !!a.resolvedAt && now - Date.parse(a.resolvedAt) < 30 * 60000;
  });

  const cur = monthOf(todayDate);
  const months = [0, -1, -2].map((n) => {
    const m = addMonths(cur, n);
    const list = (I.asgPerson.get(p.id) ?? []).filter(
      (a) => monthOf(a.date) === m && a.date <= todayDate && I.board.get(boardId(a.date, a.shift, a.factoryId))?.status === 'confirmed',
    );
    return {
      month: m,
      days: list.length,
      day: list.filter((a) => a.shift === 'day').length,
      night: list.filter((a) => a.shift === 'night').length,
      hours: list.length * s.settings.shiftHours,
      subs: list.filter((a) => a.source === 'sub').length,
      missed: s.absences.filter((a) => a.personId === p.id && monthOf(a.date) === m).length,
    };
  });

  return {
    me: { id: p.id, name: p.name, lang: p.lang, empNo: p.empNo },
    now: new Date(now).toISOString(),
    today: {
      date, shift,
      times: shift ? shiftTimes(s, shift) : null,
      status: abs ? (abs.kind === 'leave' ? 'leave' : 'absent') : shift ? 'work' : 'off',
      place: confirmed && asg ? place(asg.factoryId, asg.postId) : null,
      factoryId,
      factory: I.factory.get(factoryId)?.name ?? '',
      placed: !shift || abs ? 'none' : confirmed ? (post ? 'post' : 'standby') : 'wait',
      sub: asg?.source === 'sub',
      canReport: !abs && !!shift && now < shiftStartMs(s, date, shift),
      canUndo: !!abs && abs.reportedBy === 'self' && abs.status !== 'resolved',
    },
    request: req ? {
      id: req.r.id, date: req.ab!.date, shift: req.ab!.shift, times: shiftTimes(s, req.ab!.shift),
      place: place(req.ab!.factoryId, req.ab!.postId), expiresAt: req.r.expiresAt,
    } : null,
    takenId: taken?.id ?? null,
    // 오늘 이후의 내 휴무 신청
    leaves: s.leaves.filter((l) => l.personId === p.id && l.date >= todayDate)
      .sort((a, b) => (a.date < b.date ? -1 : 1)).map((l) => ({ id: l.id, date: l.date, status: l.status })),
    leaveDays: Array.from({ length: 14 }, (_, i) => {
      const d = addDays(todayDate, i + 1);
      const l = s.leaves.find((x) => x.personId === p.id && x.date === d && x.status !== 'rejected')
        ?? s.leaves.find((x) => x.personId === p.id && x.date === d);
      return { date: d, shift: scheduledShift(s, p, d), leaveId: l?.id ?? null, status: l?.status ?? null };
    }),
    months,
    weekHours: weekHours(s, p, todayDate),
  };
}

// ───────────── 체험(데모) 첫 화면 ─────────────

/** 명단(이름·조·공장·언어, 전화번호 없음)과 그날 체험 배역 */
export function rosterView(s: State, now: number) {
  const I = ix(s);
  const cast = pickDemoCast(s, now);
  const brief = (id: string | null) => {
    const p = id ? I.person.get(id) : null;
    return p ? { id: p.id, name: p.name, crew: p.crew, lang: p.lang, role: p.role, factory: I.factory.get(p.factoryId)?.name ?? '' } : null;
  };
  return {
    cast: {
      date: cast.date, shift: cast.shift, factoryId: cast.factoryId,
      // 그 교대 배치표에 사람이 들어갔는지(자동 배치를 했는지)
      placed: (I.asgBoard.get(boardId(cast.date, cast.shift, cast.factoryId)) ?? []).length > 0,
      factory: I.factory.get(cast.factoryId)?.name ?? '',
      worker1: brief(cast.worker1),
      offWorkers: cast.offWorkers.map(brief).filter(Boolean),
    },
    clock: seoul(now).time,
    people: s.people.filter((p) => p.active).map((p) => brief(p.id)!).sort((a, b) => a.name.localeCompare(b.name, 'ko')),
  };
}
