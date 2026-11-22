// 2025년 인원배치표·출근부(실제 자료)를 읽어 새한 프라텍 회사의 공장·라인·제품·근무자를 만든다.
//
//   npm run import:2025 -- "<1공장 폴더>" "<2공장 폴더>"            미리 보기(아무것도 바꾸지 않음)
//   npm run import:2025 -- "<1공장 폴더>" "<2공장 폴더>" --apply    회사 데이터에 반영
//
// 실제 이름과 제품명은 이 파일(저장소)에 들어 있지 않다. 엑셀 파일에서 읽어 회사 데이터베이스에만 넣는다.
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import type { Crew, Factory, Gender, Person, PlanCell, Post, Product, Shift, State } from '../src/lib/types';
import { crewShift } from '../src/lib/calendar';
import { addDays, dow, isDate } from '../src/lib/dates';
import { defaultSettings } from '../src/lib/seed';
import { LINE_ROLE } from '../src/lib/labels';

for (const f of ['.env.local', '.env']) if (fs.existsSync(f)) process.loadEnvFile(f);

const nospace = (v: unknown) => String(v ?? '').replace(/\s+/g, '');
const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();

// ───────────── 엑셀 읽기 ─────────────

interface Entry {
  factoryId: string;
  date: string;
  shift: Shift;
  /** 자리 열쇠(공장 안에서 유일) */
  post: string;
  group: string;
  product: string;
  names: string[];
}

const STOP = new Set(['지원', '휴무', '연차', '교육', '선별', '공석', '없음', '결근', '병가', '조퇴', '프리폼', '반장', '비고', '휴가', '미정']);

/** 근무자 칸 → 이름 목록. 「김 유옥」「전 영 미」는 한 사람, 「김명희 김옥령」「마라트,소비르」는 두 사람 */
export function splitNames(cell: string): string[] {
  const out: string[] = [];
  for (const part of cell.replace(/\(.*?\)/g, ' ').split(/[,/·、&+]+/)) {
    const toks = part.trim().split(/\s+/).filter(Boolean);
    if (!toks.length) continue;
    const people = toks.every((t) => t.length === 1) || toks[0].length === 1 || toks.slice(1).every((t) => t.length === 1) ? [toks.join('')] : toks;
    for (const n of people) if (/^[가-힣A-Za-z]{2,8}$/.test(n) && !STOP.has(n) && !/지원$/.test(n)) out.push(n);
  }
  return [...new Set(out)];
}

/** 한 날짜 시트 → 주간·야간 배치 */
function readDay(ws: XLSX.WorkSheet, factoryId: string, date: string): Entry[] {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: false });
  const h = rows.findIndex((r) => r.some((c) => nospace(c) === 'Line&운반'));
  if (h < 0) return [];
  const head = rows[h].map(nospace);
  const starts = head.map((c, i) => (c === 'Line&운반' ? i : -1)).filter((i) => i >= 0);
  const entries: Entry[] = [];
  const leaders: Record<number, string[]> = {};

  starts.forEach((start, b) => {
    const shift: Shift = b === 0 ? 'day' : 'night';
    const prodCol = head.findIndex((c, i) => i > start && c === '생산제품명');
    const workCol = head.findIndex((c, i) => i > prodCol && c === '근무자');
    if (prodCol < 0 || workCol < 0) return;
    const next = starts[b + 1] ?? Infinity;
    const cell = (r: unknown[], i: number) => (i < next ? clean(r[i]) : '');

    // 반장 이름은 표 위(2공장)나 아래(1공장)에 「반장 | 이름」으로 적혀 있다.
    for (const r of rows) {
      for (let i = start; i < Math.min(next, r.length); i++) {
        if (/반장$/.test(nospace(r[i])) && nospace(r[i]).length <= 5) {
          const names = splitNames(cell(r, i + 1));
          if (names.length) (leaders[b] ??= []).push(...names);
        }
      }
    }

    let group = '';
    let last = '';
    for (const r of rows.slice(h + 1)) {
      const labels = Array.from({ length: prodCol - start }, (_, k) => cell(r, start + k));
      if (/^비고/.test(nospace(labels[0])) || /반장$/.test(nospace(labels[0]))) break;
      if (labels.length > 1 && labels[0]) group = labels[0];
      let code = labels[labels.length - 1];
      let product = cell(r, prodCol);
      const names = splitNames(cell(r, workCol));
      // 2공장: 「프리폼」「선별」은 제품 칸에 자리 이름이 적혀 있다.
      if (!code && /^(프리폼|선별)$/.test(nospace(product))) { code = nospace(product); product = ''; }
      if (!code) {
        if (!names.length || !last) continue; // 빈 줄
        code = last; // 같은 자리의 둘째 줄(이름만 있음)
        product = '';
      }
      last = code;
      entries.push({ factoryId, date, shift, post: postKey(factoryId, group, code), group, product, names });
    }
    if (leaders[b]?.length) entries.push({ factoryId, date, shift, post: '반장', group: '', product: '', names: [...new Set(leaders[b])] });
  });
  return entries;
}

/** 자리 열쇠: 1공장은 PET·PE 두 구역에 같은 이름(OP, BOX&운반)이 있어 구역을 붙인다 */
function postKey(factoryId: string, group: string, code: string) {
  const c = nospace(code).replace(/호$/, '');
  if (/^(\d{1,2}|[A-Z]{1,2}-\d+)$/.test(c)) return /^\d$/.test(c) ? `0${c}` : c;
  const zone = factoryId === 'f1' ? (/^PE(?!T)/.test(nospace(group)) ? 'PE ' : 'PET ') : '';
  if (/운반|박스|BOX|밴딩/i.test(c)) return `${zone}운반`;
  if (/^OP$/i.test(c)) return `${zone}OP`;
  if (/선별/.test(c)) return `${zone}선별`;
  return c;
}

function readFactory(dir: string, factoryId: string): { entries: Entry[]; files: number; sheets: number } {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p);
      else if (/\.(xlsx|xls)$/i.test(f.name) && !f.name.startsWith('~$') && !/출근부/.test(f.name) && !/version/i.test(f.name)) files.push(p);
    }
  };
  walk(dir);
  const entries: Entry[] = [];
  let sheets = 0;
  for (const file of files) {
    const y = /(20\d{2})년/.exec(path.basename(file))?.[1] ?? '2025';
    const wb = XLSX.read(fs.readFileSync(file), { cellDates: true });
    for (const name of wb.SheetNames) {
      const m = /^(\d{1,2})-(\d{1,2})$/.exec(name.trim());
      if (!m) continue;
      const date = `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
      if (!isDate(date)) continue; // 11-31 같은 없는 날짜
      const day = readDay(wb.Sheets[name], factoryId, date);
      if (day.some((e) => e.names.length)) { entries.push(...day); sheets++; }
    }
  }
  return { entries, files: files.length, sheets };
}

/** 1공장 출근부(가장 최근 달) → 소속·조 */
function readRoster(dir: string): Map<string, { crew: Crew; affiliation: Person['affiliation'] }> {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p);
      else if (/출근부/.test(f.name) && /\.xlsx?$/i.test(f.name) && !f.name.startsWith('~$')) files.push(p);
    }
  };
  walk(dir);
  const month = (f: string) => +(/(\d{1,2})월\.xlsx?$/i.exec(f.replace(/O(\d)월/, '0$1월'))?.[1] ?? 0);
  files.sort((a, b) => month(a) - month(b));
  const out = new Map<string, { crew: Crew; affiliation: Person['affiliation'] }>();
  for (const file of files) { // 뒤 달이 앞 달을 덮어쓴다
    const wb = XLSX.read(fs.readFileSync(file));
    for (const name of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: '', raw: false });
      const h = rows.findIndex((r) => nospace(r[0]) === '소속' && nospace(r[2]) === '성명');
      if (h < 0) continue;
      for (const r of rows.slice(h + 1)) {
        const [person] = splitNames(clean(r[2]));
        const c = nospace(r[1]).toUpperCase();
        if (!person || !c) continue;
        const crew: Crew = c === 'A' || c === 'B' || c === 'C' ? c : 'DAY';
        out.set(person, { crew, affiliation: /새한/.test(nospace(r[0])) ? '직영' : '협력사' });
      }
    }
  }
  return out;
}

// ───────────── 회사 데이터 만들기 ─────────────

const FACTORIES: Factory[] = [
  // 교대 달력 기준일: 1공장 A조가 2025-04-27에 주간 시작, 2공장은 하루 늦다(2025년 현장 데이터 분석)
  { id: 'f1', name: '1공장', approval: 'confirm', leaderPhone: '', anchorDate: '2025-04-27' },
  { id: 'f2', name: '2공장', approval: 'draft-decide', leaderPhone: '', anchorDate: '2025-04-28' },
];

function roleOf(post: string) {
  if (/운반$/.test(post)) return '운반';
  if (/OP$/.test(post)) return 'OP';
  if (post === '반장' || post === '설비관리' || post === '생산관리') return post;
  return LINE_ROLE;
}
const isLine = (post: string) => /^(\d{2}|[A-Z]{1,2}-\d+)$/.test(post);

export function build(entries: Entry[], roster: Map<string, { crew: Crew; affiliation: Person['affiliation'] }>) {
  const settings = { ...defaultSettings(), carryExtraLines: 99 }; // 실제 자료에는 「가동 라인 6개 이상이면 운반 추가」 규칙이 없다
  const lastDate = entries.reduce((m, e) => (e.date > m ? e.date : m), '');
  const recentFrom = addDays(lastDate, -91);
  const recent = entries.filter((e) => e.date > recentFrom);

  // 자리: 최근 석 달에 한 번이라도 사람이 선 자리. 순서는 배치표에 적힌 순서
  const posts: Post[] = [];
  const postId = new Map<string, string>();
  for (const f of FACTORIES) {
    const order: string[] = [];
    for (const e of entries.filter((x) => x.factoryId === f.id && x.date === lastOf(entries, f.id))) if (!order.includes(e.post)) order.push(e.post);
    for (const e of recent.filter((x) => x.factoryId === f.id)) if (!order.includes(e.post)) order.push(e.post);
    for (const key of order) {
      const mine = recent.filter((e) => e.factoryId === f.id && e.post === key);
      const staffed = new Map<string, number>(); // 날짜·교대 → 사람 수
      const running = new Set<string>();
      for (const e of mine) {
        const k = `${e.date}|${e.shift}`;
        if (e.names.length) staffed.set(k, (staffed.get(k) ?? 0) + e.names.length);
        if (e.product || e.names.length) running.add(k);
      }
      if (!staffed.size && !(isLine(key) && running.size)) continue;
      const avg = staffed.size ? [...staffed.values()].reduce((a, b) => a + b, 0) / staffed.size : 0;
      const line = isLine(key);
      // 제품은 도는데 사람이 거의 서지 않는 라인은 무인
      const unmanned = line && running.size >= 10 && staffed.size / running.size < 0.15;
      const id = `${f.id}-${key.replace(/\s+/g, '')}`;
      postId.set(`${f.id}|${key}`, id);
      posts.push({
        id, factoryId: f.id, code: key, kind: line ? 'line' : 'fixed', role: roleOf(key),
        name: line ? (f.id === 'f1' ? (key.startsWith('PE') ? 'PE' : 'PET') : key.startsWith('P') ? '프리폼' : '사출') : key.replace(/^PET |^PE /, ''),
        unmanned, priority: line ? 10 : 20, defaultNeed: unmanned ? 0 : Math.max(1, Math.round(avg)), active: true, sort: posts.length,
      });
    }
  }

  // 제품 마스터: 표기가 제각각이라 띄어쓰기·대소문자만 맞춰 하나로 본다. 최근 석 달에 나온 제품만 「사용」
  const prodKey = (v: string) => nospace(v).toUpperCase();
  const seen = new Map<string, { name: string; last: string; n: number }>();
  for (const e of entries) {
    if (!e.product || !isLine(e.post)) continue;
    const k = prodKey(e.product);
    const cur = seen.get(k);
    if (!cur) seen.set(k, { name: e.product, last: e.date, n: 1 });
    else { cur.n++; if (e.date >= cur.last) { cur.last = e.date; cur.name = e.product; } }
  }
  const products: Product[] = [...seen.entries()]
    .sort((a, b) => Number(b[1].last > recentFrom) - Number(a[1].last > recentFrom) || b[1].n - a[1].n)
    .map(([, v], i) => ({ id: `pr${String(i + 1).padStart(4, '0')}`, code: `P-${String(i + 1).padStart(4, '0')}`, name: v.name, urgent: false, active: v.last > recentFrom }));
  const productId = new Map([...seen.keys()].map((k) => [k, products.find((p) => prodKey(p.name) === k)!.id]));

  // 기준 생산계획: 공장별 마지막 날의 배치표(「지난번과 같게」의 출발점)
  const plan: PlanCell[] = [];
  for (const f of FACTORIES) {
    const date = lastOf(entries, f.id);
    for (const post of posts.filter((p) => p.factoryId === f.id && p.kind === 'line')) {
      for (const shift of ['day', 'night'] as Shift[]) {
        const e = entries.find((x) => x.factoryId === f.id && x.date === date && x.shift === shift && x.post === post.code && (x.product || x.names.length));
        plan.push({
          id: `${date}|${shift}|${post.id}`, date, shift, postId: post.id,
          productId: e?.product ? productId.get(prodKey(e.product)) ?? null : null,
          status: post.unmanned ? 'unmanned' : e ? 'run' : 'off',
        });
      }
    }
  }

  // 근무자: 출근부에 있는 사람 + 최근 석 달에 5번 이상 배치된 사람
  interface Acc { n: number; recent: number; factory: Record<string, number>; post: Record<string, number>; product: Record<string, number>; group: Record<string, number>; shifts: { date: string; shift: Shift; factoryId: string }[]; lastPost: string; lastDate: string }
  const acc = new Map<string, Acc>();
  for (const e of entries) {
    for (const n of e.names) {
      const a = acc.get(n) ?? { n: 0, recent: 0, factory: {}, post: {}, product: {}, group: {}, shifts: [], lastPost: '', lastDate: '' };
      acc.set(n, a);
      a.n++;
      if (e.date > recentFrom) { a.recent++; a.shifts.push({ date: e.date, shift: e.shift, factoryId: e.factoryId }); }
      a.factory[e.factoryId] = (a.factory[e.factoryId] ?? 0) + 1;
      const pid = postId.get(`${e.factoryId}|${e.post}`);
      if (pid) {
        a.post[pid] = (a.post[pid] ?? 0) + 1;
        if (e.date >= a.lastDate) { a.lastDate = e.date; a.lastPost = pid; }
      }
      if (e.group) a.group[e.group] = (a.group[e.group] ?? 0) + 1;
      const pr = e.product ? productId.get(prodKey(e.product)) : undefined;
      if (pr) a.product[pr] = (a.product[pr] ?? 0) + 1;
    }
  }
  const top = (o: Record<string, number>) => Object.entries(o).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  const names = [...new Set([
    ...[...roster.keys()].filter((n) => (acc.get(n)?.recent ?? 0) > 0),
    ...[...acc.entries()].filter(([, a]) => a.recent >= 5).map(([n]) => n),
  ])];

  let agree = 0, checked = 0;
  const drafts = names.map((name) => {
    const a = acc.get(name)!;
    const factoryId = top(a.factory) || 'f1';
    const factory = FACTORIES.find((f) => f.id === factoryId)!;
    // 조: 일한 날짜·교대가 교대 달력과 가장 잘 맞는 조
    const votes: Record<string, number> = { A: 0, B: 0, C: 0 };
    for (const sft of a.shifts) for (const c of ['A', 'B', 'C'] as Crew[]) if (crewShift(settings, FACTORIES.find((f) => f.id === sft.factoryId)!, c, sft.date) === sft.shift) votes[c]++;
    const best = top(votes) as Crew;
    const share = a.shifts.length ? votes[best] / a.shifts.length : 0;
    const dayOnly = a.shifts.every((x) => x.shift === 'day') && a.shifts.filter((x) => dow(x.date) % 6 !== 0).length / Math.max(1, a.shifts.length) > 0.9;
    const inferred: Crew = share < 0.6 && dayOnly ? 'DAY' : best;
    const r = roster.get(name);
    if (r && r.crew !== 'DAY' && a.shifts.length >= 8) { checked++; if (r.crew === inferred) agree++; }
    const mainPost = top(a.post);
    const role = posts.find((p) => p.id === mainPost)?.role ?? LINE_ROLE;
    const g = top(a.group);
    const gender: Gender = /\(여\)/.test(g) ? 'F' : /\(남\)/.test(g) ? 'M' : '';
    const fixed = role !== LINE_ROLE && role !== '운반' ? mainPost : null;
    return { name, factoryId, factory, crew: r?.crew ?? inferred, role, gender, fixed, a, affiliation: r?.affiliation ?? (role === LINE_ROLE ? '협력사' : '직영') as Person['affiliation'] };
  });
  drafts.sort((x, y) => x.factoryId.localeCompare(y.factoryId) || x.crew.localeCompare(y.crew) || x.name.localeCompare(y.name, 'ko'));
  const people: Person[] = drafts.map((d, i) => ({
    id: `p${String(i + 1).padStart(3, '0')}`, empNo: String(250001 + i), name: d.name, affiliation: d.affiliation, crew: d.crew, role: d.role,
    gender: d.gender, phone: '', factoryId: d.factoryId, lang: 'ko', fixedPostId: d.fixed, lastPostId: d.a.lastPost || null,
    experience: Object.fromEntries(Object.entries(d.a.post).filter(([pid]) => posts.find((p) => p.id === pid)?.factoryId)),
    productExperience: d.a.product, skills: {}, active: true, hiredAt: '', leftAt: null,
  }));

  const state: Pick<State, 'factories' | 'posts' | 'products' | 'standards' | 'plan' | 'people' | 'settings'> = {
    factories: FACTORIES, posts, products, standards: [], plan, people, settings,
  };
  return { state, lastDate, crewCheck: { agree, checked }, allNames: acc.size };
}

function lastOf(entries: Entry[], factoryId: string) {
  return entries.filter((e) => e.factoryId === factoryId && e.names.length).reduce((m, e) => (e.date > m ? e.date : m), '');
}

// ───────────── 실행 ─────────────

async function main() {
  const args = process.argv.slice(2);
  const dirs = args.filter((a) => !a.startsWith('--'));
  const apply = args.includes('--apply');
  const company = args.find((a) => a.startsWith('--company='))?.split('=')[1] ?? 'saehan';
  if (dirs.length < 2 || !dirs.every((d) => fs.existsSync(d))) {
    console.error('사용법: npm run import:2025 -- "<1공장 근태 자료 폴더>" "<2공장 근태 자료 폴더>" [--apply] [--company=saehan]');
    process.exit(1);
  }
  const f1 = readFactory(dirs[0], 'f1');
  const f2 = readFactory(dirs[1], 'f2');
  const roster = readRoster(dirs[0]);
  const { state, lastDate, crewCheck, allNames } = build([...f1.entries, ...f2.entries], roster);

  // 요약(숫자만 — 이름은 찍지 않는다)
  console.log(`읽은 파일: 1공장 ${f1.files}개(${f1.sheets}일) · 2공장 ${f2.files}개(${f2.sheets}일) · 마지막 날짜 ${lastDate}`);
  for (const f of state.factories) {
    const posts = state.posts.filter((p) => p.factoryId === f.id);
    const people = state.people.filter((p) => p.factoryId === f.id);
    console.log(`${f.name}: 라인 ${posts.filter((p) => p.kind === 'line').length}개(무인 ${posts.filter((p) => p.unmanned).length}) · 고정 자리 ${posts.filter((p) => p.kind === 'fixed').length}개 · 근무자 ${people.length}명`);
    console.log(`  자리: ${posts.map((p) => `${p.code}${p.kind === 'fixed' ? `(${p.role})` : ''}×${p.defaultNeed}`).join(', ')}`);
    console.log(`  조: ${(['A', 'B', 'C', 'DAY'] as Crew[]).map((c) => `${c} ${people.filter((p) => p.crew === c).length}`).join(' · ')}  역할: ${[...new Set(people.map((p) => p.role))].map((r) => `${r} ${people.filter((p) => p.role === r).length}`).join(' · ')}`);
    const run = (shift: Shift) => state.plan.filter((c) => c.shift === shift && c.status === 'run' && posts.some((p) => p.id === c.postId)).length;
    console.log(`  기준 계획 가동 라인: 주간 ${run('day')} · 야간 ${run('night')}`);
  }
  console.log(`제품: ${state.products.length}종(사용 ${state.products.filter((p) => p.active).length}종) · 배치표에 나온 이름 ${allNames}개 중 ${state.people.length}명 등록`);
  console.log(`교대 달력 확인: 출근부에 조가 적힌 ${crewCheck.checked}명 중 ${crewCheck.agree}명이 12일 주기 달력과 맞음`);

  if (!apply) {
    console.log('\n미리 보기만 했습니다. 반영하려면 끝에 --apply 를 붙이세요.');
    return;
  }
  const { mutate, resetDemo, DEMO_COMPANY, getCompany } = await import('../src/server/store');
  await mutate(company, (s) => {
    if (s.assignments.length && !args.includes('--force')) throw new Error('이미 배치 기록이 있는 회사입니다. 덮어쓰려면 --force 를 붙이세요.');
    Object.assign(s, state, { assignments: [], boards: [], absences: [], requests: [], leaves: [], messages: [] });
  });
  console.log(`\n「${company}」 회사에 반영했습니다.`);
  if ((await getCompany(DEMO_COMPANY))?.demo) {
    await resetDemo(DEMO_COMPANY);
    console.log('체험 회사도 같은 공장 구조(이름은 가상)로 다시 만들었습니다.');
  }
}

if (process.argv[1] && path.basename(process.argv[1]).startsWith('import-2025')) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
