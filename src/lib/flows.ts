// 업무 흐름 — 상태(State)를 바꾸는 동작들. 저장·화면과는 무관하다.
// 배치 확정, 직접 고치기, 5.6 결근 처리, 대체 요청·응답·만료, 5.8 휴무.
import type {
  Absence, AbsenceKind, Assignment, AssignSource, Board, LeaveRequest, Message, Person, Shift, State, SubRequest,
} from './types';
import {
  boardId, cannotWorkExtra, dutyOn, effectivePlan, isOut, ix, mkAssignment, needs, outGender, outId, outInfo,
  planAssign, scheduledShift, touch, uid,
} from './engine';
import { iso } from './dates';
import { KIND_LABEL, SHIFT_LABEL } from './labels';

export class FlowError extends Error {}

const MAX_MESSAGES = 500;

export function notify(s: State, personId: string | null, body: string, channel: Message['channel'], now: number) {
  s.messages.push({ id: uid('ms'), personId, body, channel, at: iso(now) });
  if (s.messages.length > MAX_MESSAGES) s.messages.splice(0, s.messages.length - MAX_MESSAGES);
}

export function getBoard(s: State, date: string, shift: Shift, factoryId: string): Board {
  const id = boardId(date, shift, factoryId);
  let b = ix(s).board.get(id);
  if (!b) {
    b = { id, date, shift, factoryId, status: 'draft', stoppedPostIds: [] };
    s.boards.push(b);
    touch(s);
  }
  return b;
}

// ───────────── 근무 이력(experience) ─────────────

function countExp(s: State, a: Assignment, sign: 1 | -1) {
  const I = ix(s);
  const p = I.person.get(a.personId);
  const post = I.post.get(a.postId);
  if (!p || !post) return;
  p.experience[post.id] = Math.max(0, (p.experience[post.id] ?? 0) + sign);
  const productId = effectivePlan(s, post, a.date, a.shift).productId;
  if (productId) p.productExperience[productId] = Math.max(0, (p.productExperience[productId] ?? 0) + sign);
  if (sign > 0) p.lastPostId = post.id;
  a.counted = sign > 0;
}

/** 배치를 넣는다. 한 사람이 같은 날 두 자리에 들어가지 못하게 막는다. */
function addAsg(s: State, a: Assignment) {
  const I = ix(s);
  if (I.asgPD.get(`${a.personId}|${a.date}`)?.length) {
    throw new FlowError('이미 같은 날 다른 자리에 배치된 사람입니다.');
  }
  s.assignments.push(a);
  touch(s);
  if (ix(s).board.get(boardId(a.date, a.shift, a.factoryId))?.status === 'confirmed') countExp(s, a, 1);
}

function delAsg(s: State, id: string) {
  const i = s.assignments.findIndex((a) => a.id === id);
  if (i < 0) return;
  const a = s.assignments[i];
  if (a.counted) countExp(s, a, -1);
  s.assignments.splice(i, 1);
  touch(s);
}

function rowFor(s: State, factoryId: string, date: string, shift: Shift, postId: string) {
  const row = needs(s, factoryId, date, shift).find((r) => r.post.id === postId);
  if (!row) throw new FlowError('없는 자리입니다.');
  return row;
}

function person(s: State, id: string): Person {
  const p = ix(s).person.get(id);
  if (!p) throw new FlowError('없는 근무자입니다.');
  return p;
}

// ───────────── 생산계획 ─────────────

export function setPlan(
  s: State, o: { date: string; shift: Shift; postId: string; productId: string | null; status: 'run' | 'off' | 'unmanned' },
) {
  const I = ix(s);
  if (!I.post.get(o.postId)) throw new FlowError('없는 라인입니다.');
  if (o.productId && !I.product.get(o.productId)) throw new FlowError('제품 마스터에 없는 제품입니다.');
  const id = `${o.date}|${o.shift}|${o.postId}`;
  const cell = s.plan.find((c) => c.id === id);
  if (cell) { cell.productId = o.productId; cell.status = o.status; }
  else s.plan.push({ id, ...o });
  touch(s);
}

// ───────────── 5.5 자동 배치 · 확정 ─────────────

export function autoAssign(s: State, factoryId: string, date: string, shift: Shift, now: number) {
  const board = getBoard(s, date, shift, factoryId);
  const plan = planAssign(s, factoryId, date, shift, now);
  for (const a of plan.remove) delAsg(s, a.id);
  for (const a of plan.add) addAsg(s, a);
  // 배치 전에 들어온 결근은 이번 자동 배치에 반영됐다.
  for (const ab of s.absences) {
    if (ab.status === 'pre-board' && ab.date === date && ab.shift === shift && ab.factoryId === factoryId) {
      ab.status = 'not-needed';
    }
  }
  touch(s);
  return { board, placed: plan.add.length, removed: plan.remove.length, standby: plan.standby.length, vacancies: plan.vacancies };
}

export function confirmBoard(s: State, factoryId: string, date: string, shift: Shift, now: number) {
  const board = getBoard(s, date, shift, factoryId);
  const was = board.status;
  board.status = 'confirmed';
  const I = ix(s);
  const list = I.asgBoard.get(board.id) ?? [];
  for (const a of list) {
    if (!a.counted) countExp(s, a, 1);
    if (was !== 'confirmed' && !isOut(a.personId)) {
      const post = I.post.get(a.postId);
      notify(s, a.personId, `오늘 근무: ${date} ${SHIFT_LABEL[shift]} · ${post?.code ?? ''} ${post?.name ?? ''}`, 'push', now);
    }
  }
  touch(s);
  return board;
}

// ───────────── 직접 고치기 (잠금) ─────────────

/** 빈자리에 사람을 직접 넣는다. 같은 배치표의 다른 자리에 있던 사람이면 옮긴다. */
export function placeManual(
  s: State, o: { factoryId: string; date: string; shift: Shift; postId: string; personId: string }, now: number,
) {
  const p = person(s, o.personId);
  if (!p.active) throw new FlowError('퇴사 처리된 근무자입니다.');
  const row = rowFor(s, o.factoryId, o.date, o.shift, o.postId);
  getBoard(s, o.date, o.shift, o.factoryId);
  const cur = ix(s).asgPD.get(`${p.id}|${o.date}`)?.[0];
  let source: AssignSource = 'manual';
  if (cur) {
    if (cur.shift !== o.shift || cur.factoryId !== o.factoryId) throw new FlowError('이미 같은 날 다른 배치표에 들어가 있습니다.');
    if (cur.postId === o.postId) return cur;
    delAsg(s, cur.id);
    source = 'move';
  } else if (scheduledShift(s, p, o.date) === o.shift && p.factoryId === o.factoryId) {
    source = 'move'; // 대기 인원 이동
  }
  const a = mkAssignment(s, row, p, o.date, o.shift, source, true, '직접 배치', now);
  addAsg(s, a);
  return a;
}

/** 이름 칸 → 다른 사람으로 바꾸기. 다른 자리 사람을 고르면 두 사람을 맞바꾼다. */
export function replaceAssignment(s: State, assignmentId: string, newPersonId: string, now: number) {
  const a = s.assignments.find((x) => x.id === assignmentId);
  if (!a) throw new FlowError('없는 배치입니다.');
  if (a.personId === newPersonId) return;
  const np = person(s, newPersonId);
  if (!np.active) throw new FlowError('퇴사 처리된 근무자입니다.');
  const old = ix(s).person.get(a.personId);
  const other = ix(s).asgPD.get(`${np.id}|${a.date}`)?.[0];
  const rowA = rowFor(s, a.factoryId, a.date, a.shift, a.postId);
  if (other) {
    if (other.shift !== a.shift || other.factoryId !== a.factoryId) throw new FlowError('이미 같은 날 다른 배치표에 들어가 있습니다.');
    if (!old) throw new FlowError('아웃소싱 자리는 맞바꿀 수 없습니다. 자리에 없는 사람을 고르거나 먼저 빼 주세요.');
    const rowB = rowFor(s, other.factoryId, other.date, other.shift, other.postId);
    delAsg(s, a.id);
    delAsg(s, other.id);
    addAsg(s, mkAssignment(s, rowA, np, a.date, a.shift, 'manual', true, '맞바꿈', now));
    addAsg(s, mkAssignment(s, rowB, old, a.date, a.shift, 'manual', true, '맞바꿈', now));
  } else {
    delAsg(s, a.id);
    addAsg(s, mkAssignment(s, rowA, np, a.date, a.shift, 'manual', true, '직접 배치', now));
  }
}

/** 자리에서 빼서 대기로 돌린다. */
export function unassign(s: State, assignmentId: string) {
  delAsg(s, assignmentId);
}

// ───────────── 5.6 결근 처리 ─────────────

export function reportAbsence(
  s: State,
  o: { personId: string; date: string; shift: Shift; kind: AbsenceKind; reportedBy: Absence['reportedBy']; reason?: string },
  now: number,
): Absence | null {
  const I = ix(s);
  const p = person(s, o.personId);
  // 같은 사람·날짜 중복 신고는 무시
  if (I.absPD.has(`${p.id}|${o.date}`)) return null;
  const cur = I.asgPD.get(`${p.id}|${o.date}`)?.[0];
  const shift = cur?.shift ?? o.shift;
  const factoryId = cur?.factoryId ?? p.factoryId;
  const boardHas = (I.asgBoard.get(boardId(o.date, shift, factoryId)) ?? []).length > 0;

  // 그 사람의 배치를 지우고 복구용으로 보관한다.
  const restore = cur ? { ...cur, flags: [...cur.flags] } : null;
  if (cur) delAsg(s, cur.id);

  let status: Absence['status'];
  if (!boardHas) status = 'pre-board'; // 배치 전 — 자동 배치 때 반영
  else if (!cur) status = 'not-needed'; // 자리가 없던 대기 인원
  else {
    const row = needs(s, factoryId, o.date, shift).find((r) => r.post.id === cur.postId);
    const left = (ix(s).asgBoard.get(boardId(o.date, shift, factoryId)) ?? []).filter((a) => a.postId === cur.postId).length;
    status = row && left < row.need ? 'decided' : 'not-needed';
  }

  const ab: Absence = {
    id: uid('ab'), date: o.date, shift, factoryId, personId: p.id, postId: cur?.postId ?? null,
    kind: o.kind, reportedBy: o.reportedBy, reason: o.reason ?? '', status,
    resolvedPersonId: null, round: 0, restore, createdAt: iso(now), resolvedAt: null,
  };
  s.absences.push(ab);
  touch(s);
  const post = cur ? ix(s).post.get(cur.postId) : null;
  notify(s, null, `${p.name} ${KIND_LABEL[o.kind]} 신고 · ${o.date} ${SHIFT_LABEL[shift]}${post ? ` · ${post.code}` : ''}`, 'admin', now);
  return ab;
}

/** 신고 취소: 해결 전이면 요청을 지우고 원래 배치를 되돌린다. */
export function cancelAbsence(s: State, absenceId: string, now: number) {
  const ab = s.absences.find((a) => a.id === absenceId);
  if (!ab) return false;
  if (ab.status === 'resolved') throw new FlowError('이미 다른 분이 투입되어 취소할 수 없습니다.');
  const p = ix(s).person.get(ab.personId);
  for (const r of s.requests) {
    if (r.absenceId === ab.id && r.status === 'sent') notify(s, r.personId, '요청이 취소되었습니다', 'push', now);
  }
  s.requests = s.requests.filter((r) => r.absenceId !== ab.id);
  s.absences = s.absences.filter((a) => a.id !== ab.id);
  if (ab.kind === 'leave') {
    for (const l of s.leaves) if (l.personId === ab.personId && l.date === ab.date && l.status === 'approved') l.status = 'rejected';
  }
  touch(s);
  if (ab.restore && p?.active) {
    const row = needs(s, ab.factoryId, ab.date, ab.shift).find((r) => r.post.id === ab.restore!.postId);
    const here = (ix(s).asgBoard.get(boardId(ab.date, ab.shift, ab.factoryId)) ?? []).filter((a) => a.postId === ab.restore!.postId).length;
    const free = !ix(s).asgPD.get(`${ab.personId}|${ab.date}`)?.length;
    if (row && here < row.need && free) addAsg(s, { ...ab.restore, id: uid('as'), counted: false });
  }
  if (p) notify(s, null, `${p.name} 신고 취소 · ${ab.date} ${SHIFT_LABEL[ab.shift]}`, 'admin', now);
  return true;
}

function openAbsence(s: State, absenceId: string): Absence {
  const ab = s.absences.find((a) => a.id === absenceId);
  if (!ab) throw new FlowError('없는 결근 기록입니다.');
  if (ab.status === 'resolved') throw new FlowError('이미 해결된 결근입니다.');
  if (!ab.postId) throw new FlowError('채울 자리가 없는 결근입니다.');
  return ab;
}

function resolve(s: State, ab: Absence, p: { id: string; name: string }, now: number) {
  ab.status = 'resolved';
  ab.resolvedPersonId = p.id;
  ab.resolvedAt = iso(now);
  // 다른 사람들의 요청은 취소되고 「다른 분이 가기로 했습니다」
  for (const r of s.requests) {
    if (r.absenceId === ab.id && r.status === 'sent' && r.personId !== p.id) {
      r.status = 'cancelled';
      notify(s, r.personId, '다른 분이 가기로 했습니다', 'push', now);
    }
  }
  const min = Math.max(0, Math.round((now - Date.parse(ab.createdAt)) / 60000));
  notify(s, null, `${p.name} 투입 완료 · ${min}분 만에 해결`, 'admin', now);
  touch(s);
}

/** 「바로 배치」(대기 인원) 또는 「배치」(전화 확인 후 직접 넣기) */
export function placeForAbsence(s: State, absenceId: string, personId: string, now: number) {
  const ab = openAbsence(s, absenceId);
  const p = person(s, personId);
  if (!p.active) throw new FlowError('퇴사 처리된 근무자입니다.');
  const row = rowFor(s, ab.factoryId, ab.date, ab.shift, ab.postId!);
  const standby = scheduledShift(s, p, ab.date) === ab.shift && p.factoryId === ab.factoryId;
  addAsg(s, mkAssignment(s, row, p, ab.date, ab.shift, standby ? 'move' : 'sub', true, '대체 투입', now));
  const mine = s.requests.find((r) => r.absenceId === ab.id && r.personId === p.id && r.status === 'sent');
  if (mine) { mine.status = 'accepted'; mine.respondedAt = iso(now); }
  resolve(s, ab, p, now);
}

// ───────────── 아웃소싱(일용직) 인력 ─────────────
// 내부(쉬는 사람)로 못 채운 자리는 업체에 인원수만 요청한다. 배치표에는 「업체명-남」「업체명-여」로 적는다.

function agencyOf(s: State, agencyId: string) {
  const ag = s.settings.agencies.find((x) => x.id === agencyId);
  if (!ag) throw new FlowError('아웃소싱 업체를 먼저 등록하세요.');
  return ag;
}

/** 빈자리 하나를 아웃소싱 인력으로 채운다. 그 자리의 열린 결근이 있으면 해결로 닫는다. */
export function placeOutsource(
  s: State, o: { factoryId: string; date: string; shift: Shift; postId: string; agencyId: string }, now: number,
) {
  const ag = agencyOf(s, o.agencyId);
  const row = rowFor(s, o.factoryId, o.date, o.shift, o.postId);
  const board = getBoard(s, o.date, o.shift, o.factoryId);
  const here = (ix(s).asgBoard.get(board.id) ?? []).filter((a) => a.postId === o.postId).length;
  if (here >= row.need) throw new FlowError('이 자리는 이미 다 찼습니다.');
  const a: Assignment = {
    id: uid('as'), date: o.date, shift: o.shift, factoryId: o.factoryId, postId: o.postId,
    personId: outId(ag.id, outGender(row.post)), source: 'out', locked: true, reason: '아웃소싱', flags: [],
    counted: false, createdAt: iso(now),
  };
  s.assignments.push(a);
  touch(s);
  const ab = s.absences.find((x) => x.date === o.date && x.shift === o.shift && x.factoryId === o.factoryId
    && x.postId === o.postId && (x.status === 'decided' || x.status === 'in-progress'));
  if (ab) resolve(s, ab, { id: a.personId, name: outInfo(s, a.personId).name }, now);
  return a;
}

/** 그 교대의 남은 빈자리를 모두 한 업체의 아웃소싱 인력으로 채운다. 채운 수를 돌려준다. */
export function fillOutsource(s: State, o: { factoryId: string; date: string; shift: Shift; agencyId: string }, now: number) {
  agencyOf(s, o.agencyId);
  let n = 0;
  for (const row of needs(s, o.factoryId, o.date, o.shift)) {
    const here = (ix(s).asgBoard.get(boardId(o.date, o.shift, o.factoryId)) ?? []).filter((a) => a.postId === row.post.id).length;
    for (let i = here; i < row.need; i++) { placeOutsource(s, { ...o, postId: row.post.id }, now); n++; }
  }
  return n;
}

/** 쉬는 사람에게 「요청」 — 여러 명에게 동시에 보낼 수 있다. */
export function sendRequests(s: State, absenceId: string, personIds: string[], now: number) {
  const ab = openAbsence(s, absenceId);
  const post = ix(s).post.get(ab.postId!);
  let sent = 0;
  const round = ab.round + 1;
  personIds.forEach((pid, i) => {
    const p = ix(s).person.get(pid);
    if (!p || !p.active) return;
    if (s.requests.some((r) => r.absenceId === ab.id && r.personId === pid && r.status === 'sent')) return;
    if (cannotWorkExtra(s, p, ab.date, ab.shift)) return;
    const r: SubRequest = {
      id: uid('rq'), absenceId: ab.id, personId: pid, round, rank: i + 1, status: 'sent',
      sentAt: iso(now), expiresAt: iso(now + s.settings.expiryMin * 60000), respondedAt: null,
    };
    s.requests.push(r);
    notify(s, pid, `대체 근무 요청: ${ab.date} ${SHIFT_LABEL[ab.shift]} · ${post?.code ?? ''} ${post?.name ?? ''}`, 'push', now);
    sent++;
  });
  if (sent) { ab.round = round; ab.status = 'in-progress'; }
  touch(s);
  return sent;
}

function settle(s: State, ab: Absence | undefined) {
  if (ab && ab.status === 'in-progress' && !s.requests.some((r) => r.absenceId === ab.id && r.status === 'sent')) {
    ab.status = 'decided'; // 모두 거절·무응답 → 다시 추천 목록으로
  }
}

export type RespondResult = 'accepted' | 'declined' | 'taken' | 'expired' | 'invalid';

/** 근무자의 「갈 수 있어요 / 못 가요」. 먼저 수락한 1명만 확정된다. */
export function respondRequest(s: State, requestId: string, personId: string, accept: boolean, now: number): RespondResult {
  const r = s.requests.find((x) => x.id === requestId);
  if (!r || r.personId !== personId) return 'invalid';
  const ab = s.absences.find((a) => a.id === r.absenceId);
  if (!ab) return 'invalid';
  if (ab.status === 'resolved' && ab.resolvedPersonId !== personId) return 'taken';
  if (r.status !== 'sent') return r.status === 'expired' ? 'expired' : 'invalid';
  if (Date.parse(r.expiresAt) <= now) {
    r.status = 'expired';
    settle(s, ab);
    return 'expired';
  }
  r.respondedAt = iso(now);
  if (!accept) {
    r.status = 'declined';
    settle(s, ab);
    return 'declined';
  }
  const p = person(s, personId);
  if (!ab.postId || cannotWorkExtra(s, p, ab.date, ab.shift)) {
    r.status = 'cancelled';
    settle(s, ab);
    return 'invalid';
  }
  const row = rowFor(s, ab.factoryId, ab.date, ab.shift, ab.postId);
  addAsg(s, mkAssignment(s, row, p, ab.date, ab.shift, 'sub', true, '대체 투입', now));
  r.status = 'accepted';
  resolve(s, ab, p, now);
  return 'accepted';
}

/** 기한이 지난 요청을 만료시킨다. 바뀐 게 있으면 true */
export function expireRequests(s: State, now: number) {
  let changed = false;
  for (const r of s.requests) {
    if (r.status === 'sent' && Date.parse(r.expiresAt) <= now) {
      r.status = 'expired';
      changed = true;
      settle(s, s.absences.find((a) => a.id === r.absenceId));
    }
  }
  return changed;
}

// ───────────── 5.8 휴무 ─────────────

export function requestLeave(s: State, personId: string, date: string, now: number): LeaveRequest | null {
  person(s, personId);
  // 같은 날 중복 신청은 무시
  if (s.leaves.some((l) => l.personId === personId && l.date === date && l.status !== 'rejected')) return null;
  const l: LeaveRequest = { id: uid('lv'), personId, date, kind: '휴무', status: 'pending', createdAt: iso(now) };
  s.leaves.push(l);
  const p = person(s, personId);
  notify(s, null, `${p.name} 휴무 신청 · ${date}`, 'admin', now);
  return l;
}

export function cancelLeave(s: State, id: string, personId: string) {
  const l = s.leaves.find((x) => x.id === id);
  if (!l || l.personId !== personId || l.status !== 'pending') return false;
  s.leaves = s.leaves.filter((x) => x.id !== id);
  touch(s);
  return true;
}

/** 승인하면 그날 원래 근무일인 경우 결근 처리(5.6)로 이어져 대체 추천이 뜬다. */
export function decideLeave(s: State, id: string, approve: boolean, now: number) {
  const l = s.leaves.find((x) => x.id === id);
  if (!l) throw new FlowError('없는 휴무 신청입니다.');
  if (l.status !== 'pending') return l;
  const p = person(s, l.personId);
  const shift = dutyOn(s, p, l.date);
  l.status = approve ? 'approved' : 'rejected';
  touch(s);
  notify(s, p.id, approve ? `휴무 승인 · ${l.date}` : `휴무 반려 · ${l.date}`, 'push', now);
  if (approve && shift) reportAbsence(s, { personId: p.id, date: l.date, shift, kind: 'leave', reportedBy: 'support', reason: '휴무 승인' }, now);
  return l;
}
