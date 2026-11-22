// 새한 프라텍 — 데이터 모델. 표(table) 하나가 아래 인터페이스 하나에 대응한다.

export type Shift = 'day' | 'night';
/** A·B·C = 교대조, DAY = 「주간」조(평일 주간만 근무) */
export type Crew = 'A' | 'B' | 'C' | 'DAY';
export type Lang = 'ko' | 'en' | 'mn' | 'vi';
export type Gender = '' | 'M' | 'F';

export interface Factory {
  id: string;
  name: string;
  /** confirm = 확정 한 번, draft-decide = 반장 입안 → 팀장 결정(설계만) */
  approval: 'confirm' | 'draft-decide';
  leaderPhone: string;
  /** 교대 달력 기준일: 이 날 A조가 주기의 첫날(주간 첫날)을 시작한다 */
  anchorDate: string;
}

export interface Post {
  id: string;
  factoryId: string;
  code: string;
  name: string;
  /** line = 설비 라인, fixed = 고정 자리(OP·BOX·운반·반장·설비관리·생산관리) */
  kind: 'line' | 'fixed';
  role: string;
  unmanned: boolean;
  /** 클수록 먼저 지킨다 */
  priority: number;
  defaultNeed: number;
  active: boolean;
  sort: number;
}

export interface Product {
  id: string;
  code: string;
  name: string;
  urgent: boolean;
  active: boolean;
}

/** 표준 인원: 라인 × 제품 → 필요 인원. productId = null 이면 라인 기본값 */
export interface Standard {
  id: string;
  postId: string;
  productId: string | null;
  need: number;
  gender: Gender;
}

/** 생산계획 한 칸: 그날 그 교대 그 라인에서 무엇을 만드나 */
export interface PlanCell {
  id: string;
  date: string;
  shift: Shift;
  postId: string;
  productId: string | null;
  status: 'run' | 'off' | 'unmanned';
}

export interface Person {
  id: string;
  empNo: string;
  name: string;
  affiliation: '직영' | '협력사' | '임시';
  crew: Crew;
  role: string;
  gender: Gender;
  phone: string;
  factoryId: string;
  lang: Lang;
  fixedPostId: string | null;
  lastPostId: string | null;
  /** 자리별 근무 횟수 */
  experience: Record<string, number>;
  /** 제품별 근무 횟수 */
  productExperience: Record<string, number>;
  /** 관리자가 직접 정한 숙련도 0~3 (있으면 이력보다 우선) */
  skills: Record<string, number>;
  active: boolean;
  hiredAt: string;
  leftAt: string | null;
}

export type AssignSource = 'auto' | 'manual' | 'sub' | 'move';

export interface Assignment {
  id: string;
  date: string;
  shift: Shift;
  factoryId: string;
  postId: string;
  personId: string;
  source: AssignSource;
  /** 직접 고친 자리 — 다시 자동 배치해도 유지 */
  locked: boolean;
  reason: string;
  /** no-exp, low-skill, role, gender, hours */
  flags: string[];
  /** 근무 이력(experience)에 이미 더했는지 */
  counted: boolean;
  createdAt: string;
}

export interface Board {
  id: string;
  date: string;
  shift: Shift;
  factoryId: string;
  status: 'draft' | 'proposed' | 'confirmed';
  /** 세운(부동) 라인 */
  stoppedPostIds: string[];
}

export type AbsenceKind = 'absent' | 'sick' | 'early' | 'late' | 'leave';
export type AbsenceStatus = 'pre-board' | 'decided' | 'in-progress' | 'resolved' | 'failed' | 'not-needed';

export interface Absence {
  id: string;
  date: string;
  shift: Shift;
  factoryId: string;
  personId: string;
  postId: string | null;
  kind: AbsenceKind;
  reportedBy: 'self' | 'leader' | 'support';
  reason: string;
  status: AbsenceStatus;
  resolvedPersonId: string | null;
  round: number;
  /** 신고 취소 때 되돌릴 원래 배치 */
  restore: Assignment | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface SubRequest {
  id: string;
  absenceId: string;
  personId: string;
  round: number;
  rank: number;
  status: 'sent' | 'accepted' | 'declined' | 'expired' | 'cancelled';
  sentAt: string;
  expiresAt: string;
  respondedAt: string | null;
}

export interface LeaveRequest {
  id: string;
  personId: string;
  date: string;
  kind: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

export interface Message {
  id: string;
  /** null = 관리자 쪽 알림 */
  personId: string | null;
  body: string;
  channel: 'push' | 'alimtalk' | 'sms' | 'admin';
  at: string;
}

export interface Settings {
  /** 요청 응답 기한(분) */
  expiryMin: number;
  /** 교대 1회 인정 시간 */
  shiftHours: number;
  maxWeekHours: number;
  dayStart: string;
  nightStart: string;
  weights: { samePost: number; sameProduct: number; sameFactory: number; roleMatch: number; recentSub: number };
  /** 숙련도 0~3 단계별 예상 가동률(%) */
  skillRates: number[];
  /** 교대 주기. D = 주간, N = 야간, O = 휴무. 한 글자가 하루 */
  cyclePattern: string;
  /** 조별로 A조보다 며칠 늦게 주기를 시작하는지 */
  crewOffsets: Record<string, number>;
  /** 가동 라인이 이 수 이상이면 운반 1명 추가 */
  carryExtraLines: number;
  /** 데모 시계: 실제 시각에 더하는 분 */
  clockOffsetMin: number;
}

export interface State {
  factories: Factory[];
  posts: Post[];
  products: Product[];
  standards: Standard[];
  plan: PlanCell[];
  people: Person[];
  assignments: Assignment[];
  boards: Board[];
  absences: Absence[];
  requests: SubRequest[];
  leaves: LeaveRequest[];
  messages: Message[];
  settings: Settings;
}

export const COLLECTIONS = [
  'factories', 'posts', 'products', 'standards', 'plan', 'people',
  'assignments', 'boards', 'absences', 'requests', 'leaves', 'messages',
] as const;
export type Collection = (typeof COLLECTIONS)[number];
