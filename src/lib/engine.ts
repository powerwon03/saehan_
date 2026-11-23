// 업무 규칙 엔진 — 화면·저장소와 무관한 순수 함수.
// 필요 인원 계산, 근무 가능 판단, 숙련도, 배치 점수, 자동 배치 계획, 대체 인력 추천.
import type {
  Absence, Assignment, AssignSource, Board, Factory, Gender, Person, PlanCell, Post, Product, Shift, Standard, State,
} from './types';
import { addDays, iso, weekStart } from './dates';
import { crewShift } from './calendar';
import { LINE_ROLE } from './labels';

export const boardId = (date: string, shift: Shift, factoryId: string) => `${date}|${shift}|${factoryId}`;
export const uid = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`;
const pd = (personId: string, date: string) => `${personId}|${date}`;

// ───────────────────────── 색인 ─────────────────────────
// 상태를 바꾼 뒤에는 touch(state)를 불러 색인을 버린다.

interface Ix {
  asgPD: Map<string, Assignment[]>;
  asgBoard: Map<string, Assignment[]>;
  asgPerson: Map<string, Assignment[]>;
  absPD: Map<string, Absence>;
  leavePD: Set<string>;
  plan: Map<string, PlanCell[]>;
  std: Map<string, Standard>;
  person: Map<string, Person>;
  post: Map<string, Post>;
  factory: Map<string, Factory>;
  product: Map<string, Product>;
  board: Map<string, Board>;
}

const cache = new WeakMap<State, Ix>();
export function touch(s: State) {
  cache.delete(s);
}

function push<V>(m: Map<string, V[]>, k: string, v: V) {
  const a = m.get(k);
  if (a) a.push(v);
  else m.set(k, [v]);
}

export function ix(s: State): Ix {
  let I = cache.get(s);
  if (I) return I;
  I = {
    asgPD: new Map(), asgBoard: new Map(), asgPerson: new Map(), absPD: new Map(), leavePD: new Set(),
    plan: new Map(), std: new Map(),
    person: new Map(s.people.map((p) => [p.id, p])),
    post: new Map(s.posts.map((p) => [p.id, p])),
    factory: new Map(s.factories.map((f) => [f.id, f])),
    product: new Map(s.products.map((p) => [p.id, p])),
    board: new Map(s.boards.map((b) => [b.id, b])),
  };
  for (const a of s.assignments) {
    push(I.asgPD, pd(a.personId, a.date), a);
    push(I.asgBoard, boardId(a.date, a.shift, a.factoryId), a);
    push(I.asgPerson, a.personId, a);
  }
  for (const a of s.absences) I.absPD.set(pd(a.personId, a.date), a);
  for (const l of s.leaves) if (l.status === 'approved') I.leavePD.add(pd(l.personId, l.date));
  for (const c of s.plan) push(I.plan, `${c.postId}|${c.shift}`, c);
  for (const arr of I.plan.values()) arr.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  for (const st of s.standards) I.std.set(`${st.postId}|${st.productId ?? ''}`, st);
  cache.set(s, I);
  return I;
}

// ───────────────────────── 아웃소싱(일용직) 인력 ─────────────────────────
// 업체에 인원수만 요청하고 누가 올지는 정해지지 않으므로 사람 표에 넣지 않는다.
// 배치에는 `out:업체id:성별:난수` 를 사람 id 자리에 적고, 화면에는 「업체명-남」「업체명-여」로 보인다.

export const isOut = (personId: string | null | undefined) => !!personId && personId.startsWith('out:');

/** 그 자리에 요청할 일용직 구분: 품질검사원 자리는 여, 그 밖(운반·박스 등)은 남 */
export const outGender = (post: Post): 'M' | 'F' => (post.role === LINE_ROLE ? 'F' : 'M');

export const outId = (agencyId: string, gender: 'M' | 'F') => `out:${agencyId}:${gender}:${uid('x').slice(2)}`;

export function outInfo(s: State, personId: string) {
  const [, agencyId = '', g = 'F'] = personId.split(':');
  const gender: 'M' | 'F' = g === 'M' ? 'M' : 'F';
  const agency = s.settings.agencies.find((a) => a.id === agencyId);
  return { agencyId, gender, agency, name: `${agency?.name ?? '아웃소싱'}-${gender === 'M' ? '남' : '여'}` };
}

/** 사람 이름. 아웃소싱 인력이면 「업체명-여」 */
export function personName(s: State, personId: string | null | undefined): string {
  if (!personId) return '';
  if (isOut(personId)) return outInfo(s, personId).name;
  return ix(s).person.get(personId)?.name ?? '(삭제됨)';
}

// ───────────────────────── 5.3 필요 인원 ─────────────────────────

export interface EffectivePlan {
  productId: string | null;
  status: 'run' | 'off' | 'unmanned';
  /** 그날 계획이 없어 지난 계획을 이어 쓴 것인지 */
  inherited: boolean;
}

/** 그날 계획이 없으면 같은 교대의 가장 최근 계획을 이어 쓴다(「지난번과 같게」). */
export function effectivePlan(s: State, post: Post, date: string, shift: Shift): EffectivePlan {
  const cells = ix(s).plan.get(`${post.id}|${shift}`);
  const cell = cells?.find((c) => c.date <= date);
  if (!cell) return { productId: null, status: post.unmanned ? 'unmanned' : 'run', inherited: true };
  return { productId: cell.productId, status: cell.status, inherited: cell.date !== date };
}

export function standardFor(s: State, postId: string, productId: string | null): Standard | undefined {
  const I = ix(s);
  return (productId ? I.std.get(`${postId}|${productId}`) : undefined) ?? I.std.get(`${postId}|`);
}

export interface NeedRow {
  post: Post;
  productId: string | null;
  status: 'run' | 'off' | 'unmanned';
  inherited: boolean;
  stopped: boolean;
  need: number;
  gender: Gender;
}

export function needs(s: State, factoryId: string, date: string, shift: Shift): NeedRow[] {
  const board = ix(s).board.get(boardId(date, shift, factoryId));
  const stopped = new Set(board?.stoppedPostIds ?? []);
  const posts = s.posts.filter((p) => p.factoryId === factoryId && p.active).sort((a, b) => a.sort - b.sort);
  const rows: NeedRow[] = [];
  for (const post of posts) {
    if (post.kind !== 'line') continue;
    const pl = effectivePlan(s, post, date, shift);
    const isStopped = stopped.has(post.id);
    let need = 0;
    let gender: Gender = '';
    if (pl.status === 'run' && !isStopped && !post.unmanned) {
      const st = standardFor(s, post.id, pl.productId);
      need = st ? st.need : post.defaultNeed;
      gender = st?.gender ?? '';
    }
    rows.push({ post, productId: pl.productId, status: pl.status, inherited: pl.inherited, stopped: isStopped, need, gender });
  }
  // 가동 라인 = 쉼·부동이 아닌 라인(무인 라인 포함)
  const running = rows.filter((r) => r.status !== 'off' && !r.stopped).length;
  for (const post of posts) {
    if (post.kind !== 'fixed') continue;
    let need = 0;
    if (running > 0) {
      need = post.defaultNeed;
      if (post.role === '운반' && running >= s.settings.carryExtraLines) need += 1;
    }
    rows.push({ post, productId: null, status: 'run', inherited: true, stopped: false, need, gender: '' });
  }
  return rows.sort((a, b) => a.post.sort - b.post.sort);
}

// ───────────────────────── 5.2 근무할 수 있는지 ─────────────────────────

export function scheduledShift(s: State, p: Person, date: string): Shift | null {
  if (p.hiredAt && date < p.hiredAt) return null;
  if (p.leftAt && date > p.leftAt) return null;
  const f = ix(s).factory.get(p.factoryId);
  return f ? crewShift(s.settings, f, p.crew, date) : null;
}

/** 그날 결근 신고 또는 승인된 휴무가 있는지 */
export function unavailable(s: State, p: Person, date: string) {
  const I = ix(s);
  return I.absPD.has(pd(p.id, date)) || I.leavePD.has(pd(p.id, date));
}

/** 그날 실제로(또는 예정대로) 서는 교대. 배치가 있으면 배치가 우선 */
export function dutyOn(s: State, p: Person, date: string): Shift | null {
  const a = ix(s).asgPD.get(pd(p.id, date));
  if (a?.length) return a[0].shift;
  if (unavailable(s, p, date)) return null;
  return scheduledShift(s, p, date);
}

/** 그 주(월~일)에 일한·일할 교대 수 × 교대 1회 인정 시간 */
export function weekHours(s: State, p: Person, date: string) {
  const start = weekStart(date);
  let n = 0;
  for (let i = 0; i < 7; i++) if (dutyOn(s, p, addDays(start, i))) n++;
  return n * s.settings.shiftHours;
}

/**
 * 그 달 1일부터 그날 전까지 실제로 일한 날 수(배치가 있으면 배치, 없으면 교대 달력에서 결근·휴무를 뺀 날).
 * 결원이 생기면 이 수가 적은 사람(이번 달에 쉰 날이 많은 사람)에게 먼저 연락한다.
 */
export function monthWorkDays(s: State, p: Person, date: string) {
  let n = 0;
  for (let d = `${date.slice(0, 7)}-01`; d < date; d = addDays(d, 1)) if (dutyOn(s, p, d)) n++;
  return n;
}

/** 쉬는 사람이 그 교대에 추가로 나올 수 있는지. 안 되면 사유 코드, 되면 null */
export function cannotWorkExtra(s: State, p: Person, date: string, shift: Shift): string | null {
  if (!p.active) return 'inactive';
  if (unavailable(s, p, date)) return 'absent';
  if (dutyOn(s, p, date)) return 'same-day';
  if (shift === 'day' && dutyOn(s, p, addDays(date, -1)) === 'night') return 'after-night';
  if (shift === 'night' && dutyOn(s, p, addDays(date, 1)) === 'day') return 'before-day';
  if (weekHours(s, p, date) + s.settings.shiftHours > s.settings.maxWeekHours) return 'hours';
  return null;
}

// ───────────────────────── 5.4 숙련도 ─────────────────────────

export function skillOf(s: State, p: Person, post: Post): number {
  const manual = p.skills[post.id];
  if (manual !== undefined && manual !== null) return Math.max(0, Math.min(3, manual));
  if (post.kind === 'fixed') return p.fixedPostId === post.id ? 3 : p.role === post.role ? 2 : 0;
  const n = p.experience[post.id] ?? 0;
  return n >= 30 ? 3 : n >= 10 ? 2 : n >= 1 ? 1 : 0;
}

export const rateOf = (s: State, skill: number) => (s.settings.skillRates[skill] ?? 0) / 100;

/** 최근 30일 대체·직접 배치 횟수 */
export function recentSubs(s: State, p: Person, date: string) {
  const from = addDays(date, -30);
  return (ix(s).asgPerson.get(p.id) ?? []).filter(
    (a) => (a.source === 'sub' || a.source === 'manual') && a.date > from && a.date <= date,
  ).length;
}

// ───────────────────────── 5.5 배치 점수 ─────────────────────────

export function score(s: State, p: Person, row: NeedRow, date: string, asSub: boolean) {
  const w = s.settings.weights;
  const post = row.post;
  let v = rateOf(s, skillOf(s, p, post)) * 100;
  if (p.lastPostId === post.id) v += w.samePost;
  v += Math.min(p.experience[post.id] ?? 0, 50) * 0.2;
  // 라인 배정은 「생산 제품 → 숙련도」 순으로 본다: 그 제품을 해 본 사람이 숙련도 차이보다 항상 앞선다.
  const made = row.productId ? p.productExperience[row.productId] ?? 0 : 0;
  if (made > 0) v += 200 + Math.min(made, 50) * 0.4 + w.sameProduct;
  if (p.factoryId === post.factoryId) v += w.sameFactory;
  v += p.role === post.role ? w.roleMatch : -20;
  if (asSub) v -= recentSubs(s, p, date) * w.recentSub;
  v -= Math.max(0, weekHours(s, p, date) - 40) * 0.5;
  return v;
}

export function flagsFor(s: State, p: Person, row: NeedRow, date: string): string[] {
  const f: string[] = [];
  const sk = skillOf(s, p, row.post);
  if (sk === 0) f.push('no-exp');
  else if (sk === 1) f.push('low-skill');
  if (p.role !== row.post.role) f.push('role');
  if (row.gender && p.gender !== row.gender) f.push('gender');
  if (weekHours(s, p, date) >= 44) f.push('hours');
  return f;
}

export function mkAssignment(
  s: State, row: NeedRow, p: Person, date: string, shift: Shift,
  source: AssignSource, locked: boolean, reason: string, now: number,
): Assignment {
  return {
    id: uid('as'), date, shift, factoryId: row.post.factoryId, postId: row.post.id, personId: p.id,
    source, locked, reason, flags: flagsFor(s, p, row, date), counted: false, createdAt: iso(now),
  };
}

/** 그 교대 정규 근무자인데 아직 아무 자리에도 없는 사람(대기 인원) */
export function standbyPeople(s: State, factoryId: string, date: string, shift: Shift): Person[] {
  const I = ix(s);
  return s.people
    .filter((p) => p.active && p.factoryId === factoryId && scheduledShift(s, p, date) === shift
      && !unavailable(s, p, date) && !I.asgPD.get(pd(p.id, date))?.length)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

// ───────────────────────── 5.5 자동 배치 ─────────────────────────

export interface AssignPlan {
  rows: NeedRow[];
  keep: Assignment[];
  add: Assignment[];
  remove: Assignment[];
  standby: Person[];
  vacancies: number;
}

/** 자동 배치 계획을 만든다(상태는 바꾸지 않는다). 한 공장·한 교대 단위. */
export function planAssign(s: State, factoryId: string, date: string, shift: Shift, now: number): AssignPlan {
  const I = ix(s);
  const rows = needs(s, factoryId, date, shift);
  const existing = I.asgBoard.get(boardId(date, shift, factoryId)) ?? [];
  const keep: Assignment[] = [];
  const remove: Assignment[] = [];
  const open: NeedRow[] = [];

  // 1·2. 필요 인원만큼 칸을 만들고, 잠긴 배치와 이미 들어간 사람은 그대로 둔다.
  for (const row of rows) {
    const here = existing.filter((a) => a.postId === row.post.id);
    const locked = here.filter((a) => a.locked);
    keep.push(...locked);
    let left = row.need - locked.length;
    for (const a of here) {
      if (a.locked) continue;
      if (left > 0) { keep.push(a); left--; } else remove.push(a);
    }
    for (let i = 0; i < left; i++) open.push(row);
  }
  for (const a of existing) {
    if (!rows.some((r) => r.post.id === a.postId)) (a.locked ? keep : remove).push(a);
  }

  // 3. 후보 = 그 교대 정규 근무자 중 아직 안 들어간 사람
  const busy = new Set(keep.map((a) => a.personId));
  const removed = new Set(remove.map((a) => a.id));
  let pool = s.people
    .filter((p) => {
      if (!p.active || p.factoryId !== factoryId || busy.has(p.id)) return false;
      if (scheduledShift(s, p, date) !== shift || unavailable(s, p, date)) return false;
      const other = (I.asgPD.get(pd(p.id, date)) ?? []).filter((a) => !removed.has(a.id));
      return other.length === 0;
    })
    .sort((a, b) => (a.id < b.id ? -1 : 1));

  const add: Assignment[] = [];
  const place = (p: Person, row: NeedRow) => {
    add.push(mkAssignment(s, row, p, date, shift, 'auto', false, '', now));
    pool = pool.filter((x) => x.id !== p.id);
  };

  // 4. 고정 자리는 지정된 사람을 먼저 넣는다.
  const rest: NeedRow[] = [];
  for (const row of open) {
    const p = row.post.kind === 'fixed' ? pool.find((x) => x.fixedPostId === row.post.id) : undefined;
    if (p) place(p, row);
    else rest.push(row);
  }

  // 5. 단독 가능(숙련도 2 이상) 후보가 적은 자리부터, 같으면 priority 높은 자리부터.
  const order = rest
    .map((row, i) => ({ row, i, solo: pool.filter((p) => skillOf(s, p, row.post) >= 2).length }))
    .sort((a, b) => a.solo - b.solo || b.row.post.priority - a.row.post.priority || a.i - b.i);

  // 6. 칸마다 점수가 가장 높은 사람(동점이면 id 순).
  let vacancies = 0;
  for (const { row } of order) {
    let cands = pool;
    if (row.gender) {
      const g = pool.filter((p) => p.gender === row.gender);
      if (g.length) cands = g;
    }
    let best: Person | null = null;
    let bestScore = -Infinity;
    for (const p of cands) {
      const v = score(s, p, row, date, false);
      if (v > bestScore) { best = p; bestScore = v; }
    }
    if (best) place(best, row);
    else vacancies++;
  }

  // 7. 남은 사람 = 대기 인원, 못 채운 칸 = 빈자리
  return { rows, keep, add, remove, standby: pool, vacancies };
}

// ───────────────────────── 5.7 대체 인력 추천 ─────────────────────────

export interface Candidate {
  personId: string;
  name: string;
  empNo: string;
  /** standby = 대기(근무 중, 자리 없음), off = 휴무(쉬는 사람) */
  type: 'standby' | 'off';
  rank: number;
  score: number;
  /** exp = 업무 경험, product = 같은 제품, 그 외 = 다른 공장 이름 */
  reasons: string[];
  /** low-skill, role, gender, hours */
  cautions: string[];
  skill: number;
  rate: number;
  lang: string;
  crew: string;
  /** 연락처(전화로 출근 가능 여부를 확인한다) */
  phone: string;
  /** 이번 달 실 근무일수 */
  monthDays: number;
}

export interface Slot {
  factoryId: string;
  date: string;
  shift: Shift;
  postId: string;
}

export function recommend(s: State, slot: Slot): Candidate[] {
  const I = ix(s);
  const row = needs(s, slot.factoryId, slot.date, slot.shift).find((r) => r.post.id === slot.postId);
  if (!row) return [];
  const out: Candidate[] = [];
  for (const p of s.people) {
    if (!p.active) continue;
    if (I.asgPD.get(pd(p.id, slot.date))?.length) continue;
    if (unavailable(s, p, slot.date)) continue;
    const sched = scheduledShift(s, p, slot.date);
    let type: 'standby' | 'off';
    if (sched === slot.shift && p.factoryId === slot.factoryId) type = 'standby';
    else if (sched) continue; // 같은 날 다른 교대·다른 공장에서 근무 중
    else if (cannotWorkExtra(s, p, slot.date, slot.shift)) continue;
    else type = 'off';
    if (row.gender && p.gender && p.gender !== row.gender) continue;

    const skill = skillOf(s, p, row.post);
    const hasExp = skill >= 1 || (p.experience[row.post.id] ?? 0) > 0;
    const hasProduct = !!row.productId && (p.productExperience[row.productId] ?? 0) > 0;
    const sameFactory = p.factoryId === slot.factoryId;
    const hours = weekHours(s, p, slot.date);
    const monthDays = monthWorkDays(s, p, slot.date);
    // 앞 기준이 항상 이기도록 점수를 자릿수로 나눈다.
    // ① 쉬는 사람 → ② 같은 공장 → ③ 이번 달 실 근무일수가 적은 사람 → ④ 같은 제품 경험 → ⑤ 숙련도
    const v =
      (type === 'off' ? 1_000_000_000 : 0) +
      (sameFactory ? 100_000_000 : 0) +
      (40 - monthDays) * 1_000_000 +
      (hasProduct ? 100_000 : 0) +
      skill * 10_000 +
      Math.max(0, 99 - recentSubs(s, p, slot.date)) * 10 - hours / 10;

    const reasons: string[] = [];
    if (hasExp) reasons.push('exp');
    if (hasProduct) reasons.push('product');
    if (!sameFactory) reasons.push(I.factory.get(p.factoryId)?.name ?? '다른 공장');
    const cautions: string[] = [];
    if (skill <= 1) cautions.push('low-skill');
    if (p.role !== row.post.role) cautions.push('role');
    if (row.gender && p.gender !== row.gender) cautions.push('gender');
    if (hours >= 44) cautions.push('hours');

    out.push({
      personId: p.id, name: p.name, empNo: p.empNo, type, rank: 0, score: v,
      reasons, cautions, skill, rate: rateOf(s, skill), lang: p.lang, crew: p.crew, phone: p.phone, monthDays,
    });
  }
  out.sort((a, b) => b.score - a.score || (a.personId < b.personId ? -1 : 1));
  out.forEach((c, i) => (c.rank = i + 1));
  return out;
}
