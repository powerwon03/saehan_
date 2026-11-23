// 관리자·근무자가 보낼 수 있는 동작. 입력을 확인한 뒤 업무 흐름(flows)을 부른다.
import type { AbsenceKind, Crew, Gender, Lang, Person, Post, Shift, State } from '@/lib/types';
import { effectivePlan, ix, touch, uid } from '@/lib/engine';
import {
  autoAssign, cancelAbsence, cancelLeave, confirmBoard, decideLeave, fillOutsource, FlowError, placeForAbsence, placeManual,
  placeOutsource, replaceAssignment, reportAbsence, requestLeave, respondRequest, sendRequests, setPlan, unassign,
} from '@/lib/flows';
import { validPattern } from '@/lib/calendar';
import { addDays, dow, isDate, planWeekShifts, seoul } from '@/lib/dates';
import { LINE_ROLE, ROLES } from '@/lib/labels';
import { LANGS } from '@/lib/i18n';
import { currentDuty, shiftStartMs } from './views';

type A = Record<string, unknown>;

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' ? String(v) : '');
const int = (v: unknown, lo: number, hi: number, dflt = lo) => {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : dflt;
};
const bool = (v: unknown) => v === true || v === 'true' || v === 1;
function shiftOf(v: unknown): Shift {
  if (v === 'day' || v === 'night') return v;
  throw new FlowError('교대를 확인하세요.');
}
function dateOf(v: unknown): string {
  if (isDate(v)) return v;
  throw new FlowError('날짜를 확인하세요.');
}
function factoryOf(s: State, v: unknown): string {
  const id = str(v);
  if (!ix(s).factory.has(id)) throw new FlowError('공장을 확인하세요.');
  return id;
}

// ───────────── 근로자 관리 ─────────────

const CREWS: Crew[] = ['A', 'B', 'C', 'DAY'];
const AFFS = ['직영', '협력사', '임시'] as const;

function personFields(s: State, a: A, base?: Person): Omit<Person, 'id'> {
  const I = ix(s);
  const name = str(a.name, 40);
  const empNo = str(a.empNo, 20);
  if (!name) throw new FlowError('이름을 입력하세요.');
  if (!empNo) throw new FlowError('사번을 입력하세요.');
  if (s.people.some((p) => p.empNo.toLowerCase() === empNo.toLowerCase() && p.id !== (a.id ?? ''))) throw new FlowError(`이미 있는 사번입니다: ${empNo}`);
  const factoryId = factoryOf(s, a.factoryId);
  const fixedPostId = str(a.fixedPostId) || null;
  if (fixedPostId && I.post.get(fixedPostId)?.factoryId !== factoryId) throw new FlowError('지정 자리는 같은 공장의 자리여야 합니다.');
  const skills: Record<string, number> = {};
  const rawSkills = (a.skills && typeof a.skills === 'object' ? a.skills : base?.skills ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(rawSkills)) if (I.post.has(k)) skills[k] = int(v, 0, 3);
  const hiredAt = isDate(a.hiredAt) ? a.hiredAt : base?.hiredAt ?? '';
  return {
    empNo, name,
    affiliation: AFFS.includes(a.affiliation as never) ? (a.affiliation as Person['affiliation']) : '직영',
    crew: CREWS.includes(a.crew as Crew) ? (a.crew as Crew) : 'A',
    role: ROLES.includes(str(a.role)) ? str(a.role) : LINE_ROLE,
    gender: a.gender === 'M' || a.gender === 'F' ? (a.gender as Gender) : '',
    phone: str(a.phone, 20),
    factoryId,
    lang: LANGS.includes(a.lang as Lang) ? (a.lang as Lang) : 'ko',
    fixedPostId,
    lastPostId: base?.lastPostId ?? null,
    experience: base?.experience ?? {},
    productExperience: base?.productExperience ?? {},
    skills,
    active: base?.active ?? true,
    hiredAt,
    leftAt: base?.leftAt ?? null,
  };
}

function savePerson(s: State, a: A, today: string) {
  const id = str(a.id);
  if (id) {
    const p = s.people.find((x) => x.id === id);
    if (!p) throw new FlowError('없는 근무자입니다.');
    Object.assign(p, personFields(s, a, p));
    return p;
  }
  const p: Person = { id: uid('p'), ...personFields(s, { ...a, hiredAt: isDate(a.hiredAt) ? a.hiredAt : today }) };
  s.people.push(p);
  return p;
}

function deletePerson(s: State, id: string) {
  s.people = s.people.filter((p) => p.id !== id);
  s.assignments = s.assignments.filter((a) => a.personId !== id);
  const abs = new Set(s.absences.filter((a) => a.personId === id).map((a) => a.id));
  s.absences = s.absences.filter((a) => a.personId !== id);
  s.requests = s.requests.filter((r) => r.personId !== id && !abs.has(r.absenceId));
  s.leaves = s.leaves.filter((l) => l.personId !== id);
  s.messages = s.messages.filter((m) => m.personId !== id);
}

// ───────────── 엑셀 가져오기 ─────────────

const pickCol = (row: A, ...names: string[]) => {
  for (const n of names) if (row[n] !== undefined && str(row[n]) !== '') return str(row[n]);
  return '';
};
const normDate = (v: string) => {
  const m = v.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (!m) return '';
  const d = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return isDate(d) ? d : '';
};
const CREW_IN: Record<string, Crew> = { A: 'A', B: 'B', C: 'C', A조: 'A', B조: 'B', C조: 'C', 주간: 'DAY', 주간조: 'DAY', DAY: 'DAY' };
const LANG_IN: Record<string, Lang> = { 한국어: 'ko', 영어: 'en', 몽골어: 'mn', 베트남어: 'vi', 네팔어: 'ne', ko: 'ko', en: 'en', mn: 'mn', vi: 'vi', ne: 'ne' };
const SKILL_WORDS: Record<string, number> = { 없음: 0, '-': 0, 초급: 1, 보조: 1, 중급: 2, 단독: 2, 숙련: 3, 지도: 3 };
/** 숙련도 칸: 0~3 또는 없음·초급·중급·숙련. 빈칸은 바꾸지 않는다 */
function skillIn(v: string): number | undefined {
  if (!v) return undefined;
  if (/^[0-3]$/.test(v)) return Number(v);
  const k = Object.keys(SKILL_WORDS).find((w) => v.includes(w));
  return k === undefined ? undefined : SKILL_WORDS[k];
}
const GENDER_IN: Record<string, Gender> = { 남: 'M', 여: 'F', M: 'M', F: 'F', 남자: 'M', 여자: 'F' };

/** 직원 명단: 사번 기준 등록·수정. 퇴사일이 있으면 퇴사 처리. 라인 코드 열 = 숙련도(0~3) */
function importPeople(s: State, rows: A[], today: string) {
  let created = 0, updated = 0;
  const errors: string[] = [];
  rows.slice(0, 2000).forEach((row, i) => {
    try {
      const empNo = pickCol(row, '사번');
      const name = pickCol(row, '이름');
      if (!empNo && !name) return;
      if (!empNo) throw new FlowError('사번이 없습니다.');
      const cur = s.people.find((p) => p.empNo.toLowerCase() === empNo.toLowerCase());
      const fname = pickCol(row, '공장');
      const factory = s.factories.find((f) => f.name === fname || f.id === fname) ?? (cur ? ix(s).factory.get(cur.factoryId) : undefined);
      if (!factory) throw new FlowError(`공장을 알 수 없습니다: ${fname || '(빈칸)'}`);
      const posts = s.posts.filter((p) => p.factoryId === factory.id);
      const fixedCode = pickCol(row, '지정자리');
      const fixed = fixedCode ? posts.find((p) => p.code === fixedCode) : undefined;
      if (fixedCode && !fixed) throw new FlowError(`지정자리를 알 수 없습니다: ${fixedCode}`);
      const skills: Record<string, number> = { ...(cur?.skills ?? {}) };
      for (const p of posts) {
        const v = pickCol(row, p.code);
        const lv = skillIn(v);
        if (lv !== undefined) skills[p.id] = lv;
      }
      const crewIn = pickCol(row, '조');
      const p = savePerson(s, {
        id: cur?.id, empNo, name: name || cur?.name,
        affiliation: pickCol(row, '소속') || cur?.affiliation,
        crew: CREW_IN[crewIn.toUpperCase()] ?? CREW_IN[crewIn] ?? cur?.crew,
        role: pickCol(row, '역할') || cur?.role,
        gender: GENDER_IN[pickCol(row, '성별')] ?? cur?.gender,
        phone: pickCol(row, '전화') || cur?.phone,
        factoryId: factory.id,
        lang: LANG_IN[pickCol(row, '언어')] ?? cur?.lang,
        hiredAt: normDate(pickCol(row, '입사일')) || cur?.hiredAt,
        fixedPostId: fixedCode ? fixed!.id : cur?.fixedPostId,
        skills,
      }, today);
      const left = normDate(pickCol(row, '퇴사일'));
      if (left) { p.active = false; p.leftAt = left; }
      if (cur) updated++; else created++;
      touch(s);
    } catch (e) {
      errors.push(`${i + 2}행: ${e instanceof Error ? e.message : '오류'}`);
    }
  });
  return { created, updated, errors };
}

const STATUS_IN: Record<string, 'run' | 'off' | 'unmanned'> = { 가동: 'run', 쉼: 'off', 무인: 'unmanned', run: 'run', off: 'off', unmanned: 'unmanned', '': 'run' };

/** 생산계획: 날짜·교대·공장·라인·제품·상태. 제품은 마스터에 있는 코드/이름만 받는다. */
function importPlan(s: State, rows: A[]) {
  let saved = 0;
  const errors: string[] = [];
  rows.slice(0, 5000).forEach((row, i) => {
    try {
      const d = normDate(pickCol(row, '날짜'));
      if (!d && !pickCol(row, '라인')) return;
      if (!d) throw new FlowError('날짜를 알 수 없습니다.');
      const sh = pickCol(row, '교대');
      const shift: Shift | null = sh === '주간' || sh === 'day' ? 'day' : sh === '야간' || sh === 'night' ? 'night' : null;
      if (!shift) throw new FlowError(`교대를 알 수 없습니다: ${sh}`);
      const fname = pickCol(row, '공장');
      const factory = s.factories.find((f) => f.name === fname || f.id === fname);
      if (!factory) throw new FlowError(`공장을 알 수 없습니다: ${fname}`);
      const code = pickCol(row, '라인');
      const post = s.posts.find((p) => p.factoryId === factory.id && p.code === code && p.kind === 'line');
      if (!post) throw new FlowError(`라인을 알 수 없습니다: ${code}`);
      const status = STATUS_IN[pickCol(row, '상태')];
      if (!status) throw new FlowError(`상태를 알 수 없습니다: ${pickCol(row, '상태')}`);
      const pv = pickCol(row, '제품');
      const product = pv ? s.products.find((p) => p.code === pv || p.name === pv) : undefined;
      if (pv && !product) throw new FlowError(`제품 마스터에 없는 제품입니다: ${pv}`);
      setPlan(s, { date: d, shift, postId: post.id, productId: product?.id ?? null, status });
      saved++;
    } catch (e) {
      errors.push(`${i + 2}행: ${e instanceof Error ? e.message : '오류'}`);
    }
  });
  return { saved, errors };
}

// ───────────── 기준 정보 · 설정 ─────────────

function saveProduct(s: State, a: A) {
  const code = str(a.code, 30), name = str(a.name, 60);
  if (!code || !name) throw new FlowError('제품 코드와 이름을 입력하세요.');
  const id = str(a.id);
  if (s.products.some((p) => p.code === code && p.id !== id)) throw new FlowError(`이미 있는 제품 코드입니다: ${code}`);
  const cur = s.products.find((p) => p.id === id);
  const next = { code, name, urgent: bool(a.urgent), active: a.active === undefined ? true : bool(a.active) };
  if (cur) Object.assign(cur, next);
  else s.products.push({ id: uid('pr'), ...next });
}

function savePost(s: State, a: A) {
  const id = str(a.id);
  const cur = s.posts.find((p) => p.id === id);
  const factoryId = cur?.factoryId ?? factoryOf(s, a.factoryId);
  const code = str(a.code, 20), name = str(a.name, 40);
  if (!code || !name) throw new FlowError('코드와 이름을 입력하세요.');
  if (s.posts.some((p) => p.factoryId === factoryId && p.code === code && p.id !== id)) throw new FlowError(`같은 공장에 이미 있는 코드입니다: ${code}`);
  const kind: Post['kind'] = cur?.kind ?? (a.kind === 'fixed' ? 'fixed' : 'line');
  const next = {
    code, name, kind,
    role: kind === 'line' ? LINE_ROLE : ROLES.includes(str(a.role)) ? str(a.role) : cur?.role ?? code,
    unmanned: kind === 'line' && bool(a.unmanned),
    priority: int(a.priority, 0, 99, cur?.priority ?? 5),
    defaultNeed: int(a.defaultNeed, 0, 20, cur?.defaultNeed ?? 1),
    active: a.active === undefined ? true : bool(a.active),
  };
  if (cur) Object.assign(cur, next);
  else s.posts.push({ id: uid('po'), factoryId, sort: Math.max(0, ...s.posts.map((p) => p.sort)) + 1, ...next });
}

function saveStandard(s: State, a: A) {
  const I = ix(s);
  const postId = str(a.postId);
  const productId = str(a.productId) || null;
  if (!I.post.has(postId)) throw new FlowError('라인을 확인하세요.');
  if (productId && !I.product.has(productId)) throw new FlowError('제품을 확인하세요.');
  const gender: Gender = a.gender === 'M' || a.gender === 'F' ? a.gender : '';
  const cur = s.standards.find((x) => x.postId === postId && x.productId === productId);
  if (cur) { cur.need = int(a.need, 0, 20); cur.gender = gender; }
  else s.standards.push({ id: uid('st'), postId, productId, need: int(a.need, 0, 20), gender });
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 필요 인원 고치기. 라인은 「이 라인에서 이 제품을 만들 때」의 기준으로 기억하고, 고정 자리는 기본 인원을 바꾼다. */
function setNeed(s: State, a: A) {
  const post = ix(s).post.get(str(a.postId));
  if (!post) throw new FlowError('자리를 확인하세요.');
  const need = int(a.need, 0, 20);
  if (post.kind === 'fixed') { post.defaultNeed = need; return; }
  const productId = str(a.productId) || null;
  if (productId && !ix(s).product.has(productId)) throw new FlowError('제품을 확인하세요.');
  const cur = s.standards.find((x) => x.postId === post.id && x.productId === productId);
  if (cur) cur.need = need;
  else s.standards.push({ id: uid('st'), postId: post.id, productId, need, gender: '' });
  touch(s);
}

function fridayOf(v: unknown): string {
  const d = dateOf(v);
  if (dow(d) !== 5) throw new FlowError('생산계획 주는 금요일에 시작합니다.');
  return d;
}

function saveAgency(s: State, a: A) {
  const name = str(a.name, 30);
  if (!name) throw new FlowError('업체 이름을 입력하세요.');
  const id = str(a.id);
  if (s.settings.agencies.some((x) => x.name === name && x.id !== id)) throw new FlowError(`이미 있는 업체입니다: ${name}`);
  const cur = s.settings.agencies.find((x) => x.id === id);
  if (cur) { cur.name = name; cur.phone = str(a.phone, 20); return cur.id; }
  const ag = { id: uid('ag').replace(/[^a-z0-9]/gi, ''), name, phone: str(a.phone, 20) };
  s.settings.agencies = [...s.settings.agencies, ag];
  return ag.id;
}

function saveSettings(s: State, a: A) {
  const v = (a.settings ?? {}) as A;
  const st = s.settings;
  st.expiryMin = int(v.expiryMin, 1, 240, st.expiryMin);
  st.shiftHours = int(v.shiftHours, 1, 24, st.shiftHours);
  st.maxWeekHours = int(v.maxWeekHours, 8, 168, st.maxWeekHours);
  st.carryExtraLines = int(v.carryExtraLines, 1, 99, st.carryExtraLines);
  if (TIME.test(str(v.dayStart))) st.dayStart = str(v.dayStart);
  if (TIME.test(str(v.nightStart))) st.nightStart = str(v.nightStart);
  if (st.dayStart >= st.nightStart) throw new FlowError('주간 시작이 야간 시작보다 빨라야 합니다.');
  const w = (v.weights ?? {}) as A;
  for (const k of ['samePost', 'sameProduct', 'sameFactory', 'roleMatch', 'recentSub'] as const) st.weights[k] = int(w[k], 0, 1000, st.weights[k]);
  if (Array.isArray(v.skillRates) && v.skillRates.length === 4) st.skillRates = v.skillRates.map((x, i) => int(x, 0, 100, st.skillRates[i]));
  const pat = str(v.cyclePattern, 60).toUpperCase();
  if (pat) {
    if (!validPattern(pat)) throw new FlowError('교대 주기는 D(주간)·N(야간)·O(휴무) 글자로만 적고, D와 N이 모두 있어야 합니다.');
    st.cyclePattern = pat;
  }
  const off = (v.crewOffsets ?? {}) as A;
  for (const c of ['A', 'B', 'C']) st.crewOffsets[c] = int(off[c], 0, 365, st.crewOffsets[c] ?? 0);
  for (const f of (Array.isArray(a.factories) ? a.factories : []) as A[]) {
    const cur = s.factories.find((x) => x.id === f.id);
    if (!cur) continue;
    if (isDate(f.anchorDate)) cur.anchorDate = f.anchorDate;
    if (str(f.name, 30)) cur.name = str(f.name, 30);
    cur.leaderPhone = str(f.leaderPhone, 20);
  }
}

// ───────────── 관리자 동작 ─────────────

export function adminAction(s: State, now: number, a: A): unknown {
  const today = seoul(now).date;
  switch (a.type) {
    case 'setPlan': {
      const status = a.status === 'off' ? 'off' : a.status === 'unmanned' ? 'unmanned' : 'run';
      setPlan(s, { date: dateOf(a.date), shift: shiftOf(a.shift), postId: str(a.postId), productId: str(a.productId) || null, status });
      return;
    }
    case 'autoAssign': {
      const r = autoAssign(s, factoryOf(s, a.factoryId), dateOf(a.date), shiftOf(a.shift), now);
      return { placed: r.placed, removed: r.removed, standby: r.standby, vacancies: r.vacancies };
    }
    case 'confirm':
      confirmBoard(s, factoryOf(s, a.factoryId), dateOf(a.date), shiftOf(a.shift), now);
      return;
    case 'absence': {
      const kinds: AbsenceKind[] = ['absent', 'sick', 'early', 'late'];
      const kind = kinds.includes(a.kind as AbsenceKind) ? (a.kind as AbsenceKind) : 'absent';
      const ab = reportAbsence(s, { personId: str(a.personId), date: dateOf(a.date), shift: shiftOf(a.shift), kind, reportedBy: 'support' }, now);
      if (!ab) throw new FlowError('이미 신고된 결근입니다.');
      return { status: ab.status };
    }
    case 'cancelAbsence':
      cancelAbsence(s, str(a.absenceId), now);
      return;
    case 'placeAbsence':
      placeForAbsence(s, str(a.absenceId), str(a.personId), now);
      return;
    case 'request': {
      const ids = (Array.isArray(a.personIds) ? a.personIds : []).map((x) => str(x)).filter(Boolean).slice(0, 10);
      const sent = sendRequests(s, str(a.absenceId), ids, now);
      if (!sent) throw new FlowError('요청을 보낼 수 있는 사람이 없습니다.');
      return { sent };
    }
    case 'placeManual':
      placeManual(s, { factoryId: factoryOf(s, a.factoryId), date: dateOf(a.date), shift: shiftOf(a.shift), postId: str(a.postId), personId: str(a.personId) }, now);
      return;
    case 'replace':
      replaceAssignment(s, str(a.assignmentId), str(a.personId), now);
      return;
    case 'unassign':
      unassign(s, str(a.assignmentId));
      return;
    case 'leaveDecide':
      decideLeave(s, str(a.id), bool(a.approve), now);
      return;

    // 아웃소싱(일용직)
    case 'agencySave':
      return { id: saveAgency(s, a) };
    case 'agencyDelete':
      s.settings.agencies = s.settings.agencies.filter((x) => x.id !== a.id);
      return;
    case 'placeOutsource':
      placeOutsource(s, { factoryId: factoryOf(s, a.factoryId), date: dateOf(a.date), shift: shiftOf(a.shift), postId: str(a.postId), agencyId: str(a.agencyId) }, now);
      return;
    case 'fillOutsource': {
      const filled = fillOutsource(s, { factoryId: factoryOf(s, a.factoryId), date: dateOf(a.date), shift: shiftOf(a.shift), agencyId: str(a.agencyId) }, now);
      if (!filled) throw new FlowError('채울 빈자리가 없습니다.');
      return { filled };
    }

    // 필요 인원 · 주 단위 생산계획
    case 'needSet': setNeed(s, a); return;
    case 'planCells': {
      const status = a.status === 'off' ? 'off' : 'run';
      const cells = (Array.isArray(a.cells) ? a.cells : []).slice(0, 14) as A[];
      const postId = str(a.postId);
      const productId = str(a.productId) || null;
      for (const c of cells) setPlan(s, { date: dateOf(c.date), shift: shiftOf(c.shift), postId, productId, status });
      if (status === 'run' && a.need !== undefined && a.need !== null && a.need !== '') setNeed(s, { postId, productId, need: a.need });
      return { saved: cells.length };
    }
    case 'planWeek': {
      const key = `${factoryOf(s, a.factoryId)}|${fridayOf(a.week)}`;
      const next = { ...s.settings.planWeeks };
      if (bool(a.final)) next[key] = true; else delete next[key];
      s.settings.planWeeks = next;
      return;
    }
    case 'planCopy': {
      // 지난주의 같은 요일·교대 계획을 이번 주에 그대로 적는다
      const factoryId = factoryOf(s, a.factoryId);
      const week = fridayOf(a.week);
      const lines = s.posts.filter((p) => p.factoryId === factoryId && p.kind === 'line' && p.active && !p.unmanned);
      const prev = planWeekShifts(addDays(week, -7));
      const copies = planWeekShifts(week).flatMap((c, i) => lines.map((post) => ({ c, post, from: effectivePlan(s, post, prev[i].date, prev[i].shift) })));
      for (const { c, post, from } of copies) setPlan(s, { date: c.date, shift: c.shift, postId: post.id, productId: from.productId, status: from.status });
      return { saved: copies.length };
    }

    case 'personSave':
      return { id: savePerson(s, a, today).id };
    case 'personRetire': {
      const p = s.people.find((x) => x.id === a.id);
      if (!p) throw new FlowError('없는 근무자입니다.');
      const left = isDate(a.date) ? a.date : today;
      p.active = false; // 기록은 남긴다
      p.leftAt = left;
      // 퇴사일 이후의 배치와 보낸 요청, 대기 중인 휴무 신청은 정리한다
      s.assignments = s.assignments.filter((x) => !(x.personId === p.id && x.date >= left));
      for (const r of s.requests) if (r.personId === p.id && r.status === 'sent') r.status = 'cancelled';
      s.leaves = s.leaves.filter((l) => l.personId !== p.id || l.status !== 'pending');
      return;
    }
    case 'personRehire': {
      const p = s.people.find((x) => x.id === a.id);
      if (!p) throw new FlowError('없는 근무자입니다.');
      p.active = true;
      p.leftAt = null;
      return;
    }
    case 'personDelete':
      deletePerson(s, str(a.id));
      return;
    case 'skillSet': {
      const p = s.people.find((x) => x.id === a.personId);
      if (!p || !ix(s).post.has(str(a.postId))) throw new FlowError('대상을 확인하세요.');
      p.skills = { ...p.skills, [str(a.postId)]: int(a.level, 0, 3) };
      return;
    }
    case 'importPeople':
      return importPeople(s, (Array.isArray(a.rows) ? a.rows : []) as A[], today);
    case 'importPlan':
      return importPlan(s, (Array.isArray(a.rows) ? a.rows : []) as A[]);

    case 'productSave': saveProduct(s, a); return;
    case 'postSave': savePost(s, a); return;
    case 'standardSave': saveStandard(s, a); return;
    case 'standardDelete':
      s.standards = s.standards.filter((x) => x.id !== a.id);
      return;
    case 'settingsSave': saveSettings(s, a); return;
    default:
      throw new FlowError('알 수 없는 동작입니다.');
  }
}

// ───────────── 근무자 동작(허용된 것만) ─────────────

export function workerAction(s: State, now: number, personId: string, a: A): unknown {
  const p = ix(s).person.get(personId);
  if (!p) throw new FlowError('없는 근무자입니다.');
  switch (a.type) {
    case 'report': {
      const { date, shift } = currentDuty(s, p, now);
      if (!shift) throw new FlowError('오늘은 근무일이 아닙니다.');
      if (now >= shiftStartMs(s, date, shift)) throw new FlowError('교대가 이미 시작되었습니다.');
      reportAbsence(s, { personId, date, shift, kind: 'absent', reportedBy: 'self' }, now);
      return;
    }
    case 'undo': {
      const { date } = currentDuty(s, p, now);
      const ab = s.absences.find((x) => x.personId === personId && x.date === date && x.reportedBy === 'self');
      if (ab) cancelAbsence(s, ab.id, now);
      return;
    }
    case 'respond':
      return { result: respondRequest(s, str(a.requestId), personId, bool(a.accept), now) };
    case 'leave': {
      const d = dateOf(a.date);
      const today = seoul(now).date;
      if (d <= today || d > addDays(today, 14)) throw new FlowError('앞으로 14일 안의 날짜만 신청할 수 있습니다.');
      requestLeave(s, personId, d, now);
      return;
    }
    case 'leaveCancel':
      cancelLeave(s, str(a.id), personId);
      return;
    case 'lang':
      if (LANGS.includes(a.lang as Lang)) p.lang = a.lang as Lang;
      return;
    default:
      throw new FlowError('허용되지 않은 동작입니다.');
  }
}
