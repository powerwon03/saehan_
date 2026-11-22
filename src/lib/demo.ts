// 체험(데모) 회사 전용: 그날의 체험 배역 고르기와 데모 시계.
// 실제 회사에서는 쓰지 않는다.
import type { Shift, State } from './types';
import { boardId, ix, planAssign, recommend } from './engine';
import { seoul, seoulMs } from './dates';

export interface DemoCast {
  date: string;
  shift: Shift;
  factoryId: string;
  /** 오늘 근무(「오늘 못 나와요」를 누를 사람) */
  worker1: string | null;
  /** 오늘 휴무(요청을 받고 「갈 수 있어요」를 누를 사람) 최대 2명 */
  offWorkers: string[];
}

const LANG_ORDER: Record<string, number> = { vi: 0, mn: 1 };

export function pickDemoCast(s: State, now: number): DemoCast {
  const today = seoul(now).date;
  const I = ix(s);

  // ① 오늘 결근이 이미 있으면 그 사람과 그 교대
  const abs = s.absences
    .filter((a) => a.date === today && a.kind !== 'leave' && a.postId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
  if (abs) {
    const off: string[] = [];
    if (abs.resolvedPersonId) off.push(abs.resolvedPersonId);
    for (const r of s.requests) {
      if (r.absenceId === abs.id && (r.status === 'sent' || r.status === 'accepted') && !off.includes(r.personId)) off.push(r.personId);
    }
    if (off.length < 2 && abs.status !== 'resolved') {
      const more = recommend(s, { factoryId: abs.factoryId, date: abs.date, shift: abs.shift, postId: abs.postId! })
        .filter((c) => c.type === 'off' && !off.includes(c.personId)).slice(0, 3)
        .sort((a, b) => (LANG_ORDER[a.lang] ?? 9) - (LANG_ORDER[b.lang] ?? 9) || a.rank - b.rank);
      for (const c of more) if (off.length < 2) off.push(c.personId);
    }
    // 쉬는 조가 대신할 수 없는 교대의 결근은 예행연습 흔적으로 보고 무시
    if (off.length) return { date: today, shift: abs.shift, factoryId: abs.factoryId, worker1: abs.personId, offWorkers: off.slice(0, 2) };
  }

  // ② 쉬는 조가 주간을 대신할 수 있는 날은 주간, 아니면 야간
  let fallback: DemoCast | null = null;
  for (const shift of ['day', 'night'] as Shift[]) {
    for (const f of s.factories) {
      const existing = I.asgBoard.get(boardId(today, shift, f.id)) ?? [];
      let sim = s;
      let list = existing;
      if (!existing.length) {
        // 아직 배치 전이면 자동 배치 결과를 미리 계산해 본다(결과는 저장하지 않는다).
        const plan = planAssign(s, f.id, today, shift, now);
        list = plan.add;
        sim = { ...s, assignments: s.assignments.concat(plan.add) };
      }
      // ③ 오늘 근무 = 배치표에 든 사람 중 한국어 사용자 먼저, 대체 후보에 쉬는 사람이 있는 자리
      const cands = list
        .filter((a) => I.post.get(a.postId)?.kind === 'line')
        .map((a) => ({ a, p: I.person.get(a.personId)! }))
        .filter((x) => x.p)
        .sort((x, y) => Number(x.p.lang !== 'ko') - Number(y.p.lang !== 'ko') || (x.p.id < y.p.id ? -1 : 1))
        .slice(0, 12);
      if (!fallback && cands[0]) fallback = { date: today, shift, factoryId: f.id, worker1: cands[0].p.id, offWorkers: [] };
      let one: DemoCast | null = null;
      for (const { a, p } of cands) {
        // ④ 오늘 휴무 = 추천 목록 앞 3명 안의 쉬는 사람(베트남어 → 몽골어 먼저) 최대 2명
        const off = recommend(sim, { factoryId: f.id, date: today, shift, postId: a.postId })
          .filter((c) => c.type === 'off').slice(0, 3)
          .sort((x, y) => (LANG_ORDER[x.lang] ?? 9) - (LANG_ORDER[y.lang] ?? 9) || x.rank - y.rank)
          .slice(0, 2).map((c) => c.personId);
        const cast = { date: today, shift, factoryId: f.id, worker1: p.id, offWorkers: off };
        if (off.length >= 2) return cast;
        if (off.length === 1 && !one) one = cast;
      }
      if (one) return one;
    }
  }
  return fallback ?? { date: today, shift: 'day', factoryId: s.factories[0]?.id ?? '', worker1: null, offWorkers: [] };
}

/**
 * 데모 시계 맞추기: 주간 교대가 이미 시작된 시각이면 「오늘 못 나와요」 버튼이 사라지므로,
 * 오늘 날짜의 교대 시작 1시간 전으로 시계를 당긴다. 바꿨으면 true
 */
export function pinDemoClock(s: State, realNow: number) {
  const real = seoul(realNow);
  const cur = seoul(realNow + s.settings.clockOffsetMin * 60000);
  if (cur.date === real.date && cur.time < s.settings.dayStart) return false;
  const target = seoulMs(real.date, s.settings.dayStart) - 60 * 60000;
  s.settings.clockOffsetMin = Math.round((target - realNow) / 60000);
  return true;
}
