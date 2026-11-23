// 처음 상태 만들기: 기본 설정, 공장·라인·제품 구조, 체험(데모)용 가상 근무자 120명.
// 구조와 가상 근무자는 원터치 라인의 데모 데이터와 같다(같은 규칙·같은 난수). 이름·전화번호는 모두 가상이다.
import type { Crew, Factory, Lang, Person, PlanCell, Post, Product, Settings, Standard, State } from './types';
import { addDays } from './dates';
import { LINE_ROLE } from './labels';

export function defaultSettings(): Settings {
  return {
    expiryMin: 20,
    shiftHours: 8,
    maxWeekHours: 52,
    dayStart: '08:00',
    nightStart: '20:00',
    weights: { samePost: 15, sameProduct: 3, sameFactory: 1, roleMatch: 5, recentSub: 25 },
    skillRates: [30, 60, 90, 100],
    // 12일 주기: 주간 4 → 휴무 2 → 야간 4 → 휴무 2
    cyclePattern: 'DDDDOONNNNOO',
    crewOffsets: { A: 0, B: 4, C: 8 },
    carryExtraLines: 6,
    clockOffsetMin: 0,
    agencies: [],
    planWeeks: {},
  };
}

export function emptyState(): State {
  return {
    factories: [], posts: [], products: [], standards: [], plan: [], people: [],
    assignments: [], boards: [], absences: [], requests: [], leaves: [], messages: [],
    settings: defaultSettings(),
  };
}

/** 선형 합동 난수 — 원본 데모 데이터와 같은 값을 내야 하므로 식을 바꾸지 않는다 */
function rng(seed: number) {
  let t = seed >>> 0;
  return () => (t = (1664525 * t + 0x3c6ef35f) >>> 0) / 0x100000000;
}

const PRODUCTS: [string, string, string, boolean][] = [
  ['pr-water500', 'P-001', '생수 500ml 프리폼', false],
  ['pr-water2l', 'P-002', '생수 2L 프리폼', false],
  ['pr-drink340', 'P-003', '음료 340ml', true],
  ['pr-sauce300', 'P-004', '소스병 300g', false],
  ['pr-cos150', 'P-005', '화장품 용기 150ml', true],
  ['pr-det1l', 'P-006', '세제 1L', false],
  ['pr-mak750', 'P-007', '막걸리 750ml', false],
];

/** [코드, 역할, 이름] */
const FIXED: [string, string, string][] = [
  ['OP', 'OP', '오퍼레이터'], ['BOX', 'BOX', 'BOX'], ['MV', '운반', '운반'], ['LD', '반장', '반장'], ['EQ', '설비관리', '설비관리'],
];

/**
 * 공장·라인·제품·표준 인원 구조와 기준 생산계획.
 * 교대 달력은 1공장이 2025-04-27에 A조 주간 시작, 2공장은 하루 늦다.
 */
export function seedStructure(s: State, today = '2025-01-02') {
  const factories: Factory[] = [
    { id: 'f1', name: '1공장', approval: 'confirm', leaderPhone: '010-0000-1001', anchorDate: '2025-04-27' },
    { id: 'f2', name: '2공장', approval: 'draft-decide', leaderPhone: '010-0000-2001', anchorDate: '2025-04-28' },
  ];
  const products: Product[] = PRODUCTS.map(([id, code, name, urgent]) => ({ id, code, name, urgent, active: true }));

  const posts: Post[] = [];
  const add = (p: Omit<Post, 'sort' | 'active' | 'unmanned'> & { unmanned?: boolean }) =>
    posts.push({ unmanned: false, ...p, active: true, sort: posts.length });
  for (let i = 1; i <= 8; i++) {
    add({ id: `f1-L${i}`, factoryId: 'f1', code: `L-${i}`, name: `성형 ${i}호기`, kind: 'line', role: LINE_ROLE, priority: 10 - i, defaultNeed: 2 });
  }
  for (let i = 1; i <= 6; i++) {
    add({ id: `f2-S${i}`, factoryId: 'f2', code: `S-${i}`, name: `사출 ${i}호기`, kind: 'line', role: LINE_ROLE, priority: 10 - i, defaultNeed: i <= 2 ? 2 : 1 });
  }
  for (let i = 1; i <= 2; i++) {
    add({ id: `f2-P${i}`, factoryId: 'f2', code: `P-${i}`, name: `프리폼 ${i}호기`, kind: 'line', role: LINE_ROLE, priority: 1, defaultNeed: 0, unmanned: true });
  }
  for (const f of factories) {
    for (const [code, role, name] of FIXED) {
      if (f.id === 'f2' && code === 'BOX') continue;
      add({ id: `${f.id}-${code}`, factoryId: f.id, code, name, kind: 'fixed', role, priority: 20, defaultNeed: 1 });
    }
  }
  add({ id: 'f2-PM', factoryId: 'f2', code: 'PM', name: '생산관리', kind: 'fixed', role: '생산관리', priority: 20, defaultNeed: 1 });

  // 표준 인원(라인 × 제품). 없는 조합은 라인 기본 인원을 쓴다.
  const standards: Standard[] = [
    { id: 'st1', postId: 'f1-L1', productId: 'pr-det1l', need: 3, gender: '' },
    { id: 'st2', postId: 'f1-L2', productId: 'pr-cos150', need: 3, gender: 'F' },
    { id: 'st3', postId: 'f2-S1', productId: 'pr-drink340', need: 3, gender: '' },
  ];

  // 기준 생산계획(「지난번과 같게」의 출발점): 어제 날짜로 라인마다 제품을 하나씩. 1공장 L-8 야간은 쉼
  const rand = rng(7);
  const plan: PlanCell[] = [];
  const date = addDays(today, -1);
  for (const p of posts.filter((x) => x.kind === 'line')) {
    for (const shift of ['day', 'night'] as const) {
      plan.push({
        id: `${date}|${shift}|${p.id}`, date, shift, postId: p.id,
        productId: p.unmanned ? 'pr-water500' : products[Math.floor(rand() * products.length)].id,
        status: p.unmanned ? 'unmanned' : p.id === 'f1-L8' && shift === 'night' ? 'off' : 'run',
      });
    }
  }
  Object.assign(s, { factories, posts, products, standards, plan });
  return s;
}

// ───────────── 가상 근무자 ─────────────

const SUR = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권', '황'];
const GIVEN_F = ['옥령', '경숙', '금순', '인순', '정자', '미숙', '순자', '영희', '명숙', '춘자', '말순', '은주', '현숙', '복순'];
const GIVEN_M = ['성호', '병철', '대수', '종민', '상훈', '동욱', '재석', '기철', '만수', '용길', '태식', '광호'];
const MN = ['바야라', '엥흐진', '투무르', '사라', '간바트', '오윤나', '바트볼드', '나랑게렐', '어르길', '수흐바트'];
const VI = ['응우옌 티 란', '쩐 반 민', '레 티 호아', '팜 반 득', '부 티 투', '호앙 반 남', '도 티 마이', '당 반 훙'];

interface Draft {
  name: string;
  affiliation: Person['affiliation'];
  crew: Crew;
  role: string;
  gender: 'M' | 'F';
  factoryId: string;
  lang: Lang;
  primary: string;
  fixedPostId?: string;
}

function seedPeople(s: State): Person[] {
  const t = rng(0x13501dd);
  const pick = <T,>(a: T[]) => a[Math.floor(t() * a.length)];
  const people: Person[] = [];
  let n = 0;

  const add = (d: Draft) => {
    n++;
    const lines = s.posts.filter((p) => p.factoryId === d.factoryId && p.kind === 'line' && !p.unmanned);
    const experience: Record<string, number> = {};
    experience[d.primary] = 15 + Math.floor(40 * t());
    if (d.role === LINE_ROLE) {
      for (let i = 0; i < 2; i++) {
        const p = pick(lines);
        experience[p.id] = (experience[p.id] ?? 0) + 1 + Math.floor(8 * t());
      }
    }
    const productExperience: Record<string, number> = {};
    for (let i = 0; i < 3; i++) {
      const pr = pick(s.products);
      productExperience[pr.id] = 1 + Math.floor(10 * t());
    }
    people.push({
      id: `p${String(n).padStart(3, '0')}`,
      empNo: String(240000 + n),
      name: d.name, affiliation: d.affiliation, crew: d.crew, role: d.role, gender: d.gender,
      phone: `010-${String(1000 + n).slice(-4)}-${String(5000 + 7 * n).slice(-4)}`,
      factoryId: d.factoryId, lang: d.lang,
      fixedPostId: d.fixedPostId ?? null, lastPostId: d.primary,
      experience, productExperience, skills: {},
      active: true,
      hiredAt: `20${18 + (n % 7)}-0${1 + (n % 9)}-01`,
      leftAt: null,
    });
  };

  for (const f of s.factories) {
    const lines = s.posts.filter((p) => p.factoryId === f.id && p.kind === 'line' && !p.unmanned);
    const fixed = s.posts.filter((p) => p.factoryId === f.id && p.kind === 'fixed');
    for (const crew of ['A', 'B', 'C'] as Crew[]) {
      // 검사원: 라인 기본 인원 합 + 2명
      const count = lines.reduce((sum, p) => sum + p.defaultNeed, 0) + 2;
      for (let i = 0; i < count; i++) {
        const foreign = t() < 0.22;
        const lang: Lang = foreign ? (t() < 0.6 ? 'mn' : 'vi') : 'ko';
        const name = lang === 'mn' ? pick(MN) : lang === 'vi' ? pick(VI) : pick(SUR) + pick(GIVEN_F);
        add({ name, affiliation: foreign ? '임시' : '협력사', crew, role: LINE_ROLE, gender: 'F', factoryId: f.id, lang, primary: lines[i % lines.length].id });
      }
      // 고정 자리(설비관리·생산관리 제외): 1명씩, 운반은 2명
      for (const p of fixed) {
        if (p.role === '설비관리' || p.role === '생산관리') continue;
        for (let i = 0; i < (p.role === '운반' ? 2 : 1); i++) {
          add({ name: pick(SUR) + pick(GIVEN_M), affiliation: '직영', crew, role: p.role, gender: 'M', factoryId: f.id, lang: 'ko', primary: p.id });
        }
      }
    }
    // 설비관리·생산관리는 지정 자리로
    for (const crew of ['A', 'B', 'C'] as Crew[]) {
      for (const p of fixed.filter((x) => x.role === '설비관리' || x.role === '생산관리')) {
        add({ name: pick(SUR) + pick(GIVEN_M), affiliation: '직영', crew, role: p.role, gender: 'M', factoryId: f.id, lang: 'ko', primary: p.id, fixedPostId: p.id });
      }
    }
  }

  // 같은 이름은 뒤에 2, 3 … 을 붙인다
  const seen = new Map<string, number>();
  for (const p of people) {
    const c = seen.get(p.name) ?? 0;
    seen.set(p.name, c + 1);
    if (c > 0) p.name = `${p.name}${c + 1}`;
  }

  // 근무 이력에서 계산한 숙련도를 표에 미리 적어 둔다(관리자가 바로 고칠 수 있게)
  for (const p of people) {
    for (const post of s.posts) {
      if (post.factoryId !== p.factoryId || post.unmanned) continue;
      let lv: number;
      if (post.kind === 'fixed') lv = p.fixedPostId === post.id ? 3 : p.role === post.role ? 2 : 0;
      else {
        const e = p.experience[post.id] ?? 0;
        lv = e >= 30 ? 3 : e >= 10 ? 2 : e >= 1 ? 1 : 0;
      }
      if (lv > 0) p.skills[post.id] = lv;
    }
  }
  return people;
}

/** 체험용 가상 아웃소싱 업체 */
const DEMO_AGENCIES = [{ id: 'agdemo1', name: '가람인력', phone: '' }, { id: 'agdemo2', name: '한빛인력', phone: '' }];

export function seedDemo(today = '2025-01-02'): State {
  const s = seedStructure(emptyState(), today);
  s.people = seedPeople(s);
  s.settings.agencies = DEMO_AGENCIES.map((a) => ({ ...a }));
  return s;
}

// ───────────── 체험 회사: 실제 공장 구조 + 가상 이름 ─────────────

const V_SUR = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권', '황', '안', '송', '류', '홍'];
const V_GIVEN = [
  '하늘', '바다', '나래', '보람', '슬기', '아름', '한별', '새봄', '가을', '다솜', '누리', '마루', '도담', '라온', '미르', '소담',
  '예솔', '우리', '이든', '초롱', '푸름', '한결', '해솔', '가람', '나루', '다온', '로운', '모아', '빛나', '새롬',
];
const V_VI = ['응우옌 반 안', '쩐 티 흐엉', '레 반 둑', '팜 티 란', '호앙 반 남', '부 티 마이', '당 반 훙', '부이 티 투', '도 반 롱', '응오 티 린', '즈엉 반 탄', '리 티 응아'];
const V_NE = [
  '수닐 타파', '비말 구룽', '라메시 라이', '프라카시 마가르', '디팍 셰르파', '산토시 타망', '아니타 림부', '비나 카르키',
  '수만 바스넷', '기타 아디카리', '라주 부다토키', '사비나 포우델', '키란 슈레스타', '마야 다할', '비카스 케이시', '푸자 반다리',
];
const V_MN = ['바트에르덴', '간볼드', '뭉흐바트', '오윤치멕', '볼드바타르', '사란게렐', '엥흐투야', '바야르마', '체렌돌람', '뭉흐체첵', '간투물', '나란투야'];

/**
 * 실제 회사 데이터에서 체험용 데이터를 만든다. 공장·라인·제품·표준 인원·기준 계획과
 * 사람 수·조·역할·숙련도는 그대로 두고, 이름·사번·전화번호만 가상으로 바꾼다.
 * 체험 회사는 비밀번호 없이 들어가므로 실제 이름을 보여 주지 않기 위해서다.
 */
export function virtualize(real: State): State {
  const s = emptyState();
  const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
  s.factories = copy(real.factories).map((f) => ({ ...f, leaderPhone: '' }));
  s.posts = copy(real.posts);
  s.products = copy(real.products);
  s.standards = copy(real.standards);
  s.plan = copy(real.plan);
  s.settings = { ...copy(real.settings), clockOffsetMin: 0, planWeeks: {} };
  // 아웃소싱 업체도 가상 이름으로 바꾼다. 실제 회사에 없으면 눌러 볼 수 있게 두 곳을 넣는다.
  const realAgencies = real.settings.agencies ?? [];
  s.settings.agencies = (realAgencies.length ? realAgencies : DEMO_AGENCIES).map((a, i) => ({
    id: a.id, name: DEMO_AGENCIES[i]?.name ?? `가상인력${i + 1}`, phone: '',
  }));

  const used = new Set<string>();
  const people = real.people.filter((p) => p.active)
    .sort((a, b) => a.factoryId.localeCompare(b.factoryId) || a.crew.localeCompare(b.crew) || a.id.localeCompare(b.id));
  let k = 0, vi = 0, mn = 0, ne = 0;
  s.people = people.map((p, i) => {
    // 검사원 일부는 네팔어·베트남어·몽골어 화면을 쓰는 사람으로 둔다(다국어 화면 체험용)
    const lang: Lang = p.role === LINE_ROLE ? (i % 7 === 1 ? 'ne' : i % 7 === 3 ? 'vi' : i % 7 === 5 ? 'mn' : 'ko') : 'ko';
    let name = lang === 'ne' ? V_NE[ne++] : lang === 'vi' ? V_VI[vi++] : lang === 'mn' ? V_MN[mn++] : undefined;
    // 준비한 외국 이름이 떨어지면 한국식 가상 이름을 쓴다
    while (!name || used.has(name)) {
      name = V_SUR[k % V_SUR.length] + V_GIVEN[(k * 7 + Math.floor(k / V_SUR.length)) % V_GIVEN.length];
      k++;
    }
    used.add(name);
    return {
      ...copy(p),
      id: `p${String(i + 1).padStart(3, '0')}`,
      empNo: String(900001 + i),
      name, lang,
      phone: `010-0000-${String(1000 + i).slice(-4)}`,
    };
  });
  return s;
}
