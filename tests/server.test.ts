import { beforeAll, describe, expect, it } from 'vitest';

// 테스트는 메모리 DB를 쓴다(실제 파일·Supabase에 닿지 않는다).
process.env.DB_PATH = ':memory:';
process.env.SUPABASE_URL = '';
process.env.NEXT_PUBLIC_SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.ADMIN_PASSWORD = 'test-admin-password';
process.env.DEMO = 'on';

import { loginAdmin, loginWorker, lockedWorkers, resetWorker, setPassword } from '@/server/accounts';
import { adminAction, workerAction } from '@/server/actions';
import { DEFAULT_COMPANY, DEMO_COMPANY, getCompany, mutate, read, resetDemo } from '@/server/store';
import { boardView, workerView } from '@/server/views';
import { hashPassword, verifyPassword } from '@/server/password';
import { seoul, seoulMs } from '@/lib/dates';

describe('비밀번호', () => {
  it('scrypt 해시로만 보관하고 검증한다', async () => {
    const h = await hashPassword('correct horse');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(h).not.toContain('correct horse');
    expect(await verifyPassword('correct horse', h)).toBe(true);
    expect(await verifyPassword('wrong', h)).toBe(false);
  });
});

describe('처음 실행', () => {
  it('새한 프라텍 회사(구조만)와 체험 회사(가상 근무자 120명)가 만들어진다', async () => {
    expect(await getCompany(DEFAULT_COMPANY)).toMatchObject({ name: '새한 프라텍', demo: false });
    expect(await getCompany(DEMO_COMPANY)).toMatchObject({ demo: true });
    expect(await read(DEFAULT_COMPANY, (s) => [s.people.length, s.factories.length, s.posts.length > 10])).toEqual([0, 2, true]);
    expect(await read(DEMO_COMPANY, (s) => s.people.length)).toBe(120);
  });
});

describe('로그인', () => {
  it('관리자: 비밀번호가 맞아야 들어가고, 5번 틀리면 10분 잠긴다', async () => {
    expect(await loginAdmin(DEFAULT_COMPANY, 'admin', 'test-admin-password')).toMatchObject({ ok: true });
    expect(await loginAdmin(DEFAULT_COMPANY, 'nobody', 'test-admin-password')).toMatchObject({ ok: false, error: 'invalid' });
    for (let i = 0; i < 4; i++) expect(await loginAdmin(DEFAULT_COMPANY, 'admin', 'x')).toMatchObject({ ok: false, error: 'invalid' });
    expect(await loginAdmin(DEFAULT_COMPANY, 'admin', 'x')).toMatchObject({ ok: false, error: 'locked', minutes: 10 });
    // 잠긴 동안에는 맞는 비밀번호도 안 된다
    expect(await loginAdmin(DEFAULT_COMPANY, 'admin', 'test-admin-password')).toMatchObject({ ok: false, error: 'locked' });
    await setPassword(DEFAULT_COMPANY, 'admin', 'admin', 'test-admin-password');
    expect(await loginAdmin(DEFAULT_COMPANY, 'admin', 'test-admin-password')).toMatchObject({ ok: true });
  });

  it('체험 회사에는 관리자 비밀번호 계정이 없다', async () => {
    expect(await loginAdmin(DEMO_COMPANY, 'admin', 'test-admin-password')).toMatchObject({ ok: false });
    expect(await loginAdmin(DEMO_COMPANY, 'admin', '1234')).toMatchObject({ ok: false });
  });

  describe('근무자: 사번 + 비밀번호', () => {
    let empNo = '', id = '', last4 = '';
    beforeAll(async () => {
      await mutate(DEFAULT_COMPANY, (s, now) => {
        adminAction(s, now, { type: 'personSave', empNo: 'SH9001', name: '김시험', factoryId: 'f1', crew: 'A', role: '검사원', phone: '010-1234-5678' });
        adminAction(s, now, { type: 'personSave', empNo: 'SH9002', name: '이퇴사', factoryId: 'f1', crew: 'B', role: '검사원', phone: '010-1111-2222' });
        const gone = s.people.find((p) => p.empNo === 'SH9002')!;
        adminAction(s, now, { type: 'personRetire', id: gone.id });
      });
      const p = await read(DEFAULT_COMPANY, (s) => s.people.find((x) => x.empNo === 'SH9001')!);
      empNo = p.empNo; id = p.id; last4 = '5678';
    });

    it('처음에는 전화번호 뒤 4자리, 재직자만', async () => {
      expect(await loginWorker(DEFAULT_COMPANY, empNo, last4)).toEqual({ ok: true, id });
      expect(await loginWorker(DEFAULT_COMPANY, 'sh9001', last4)).toMatchObject({ ok: true });
      expect(await loginWorker(DEFAULT_COMPANY, empNo, '0000')).toMatchObject({ ok: false, error: 'invalid' });
      expect(await loginWorker(DEFAULT_COMPANY, 'SH9002', '2222')).toMatchObject({ ok: false, error: 'invalid' });
      expect(await loginWorker(DEFAULT_COMPANY, 'SH0000', last4)).toMatchObject({ ok: false, error: 'invalid' });
    });

    it('개인 비밀번호를 정하면 전화번호 뒤 4자리로는 못 들어간다', async () => {
      await setPassword(DEFAULT_COMPANY, 'worker', id, '864209');
      expect(await loginWorker(DEFAULT_COMPANY, empNo, last4)).toMatchObject({ ok: false });
      expect(await loginWorker(DEFAULT_COMPANY, empNo, '864209')).toMatchObject({ ok: true });
    });

    it('5번 틀리면 잠기고, 관리자가 잠금을 풀면 처음 비밀번호로 돌아간다', async () => {
      for (let i = 0; i < 5; i++) await loginWorker(DEFAULT_COMPANY, empNo, 'bad');
      expect(await loginWorker(DEFAULT_COMPANY, empNo, '864209')).toMatchObject({ ok: false, error: 'locked' });
      expect(await lockedWorkers(DEFAULT_COMPANY)).toEqual([id]);
      await resetWorker(DEFAULT_COMPANY, id);
      expect(await lockedWorkers(DEFAULT_COMPANY)).toEqual([]);
      expect(await loginWorker(DEFAULT_COMPANY, empNo, last4)).toMatchObject({ ok: true });
    });
  });
});

describe('근무자 권한', () => {
  it('본인 데이터만 받는다 — 다른 사람 이름·전화가 없다', async () => {
    const out = await mutate(DEMO_COMPANY, (s, now) => {
      const { date } = seoul(now);
      adminAction(s, now, { type: 'autoAssign', factoryId: 'f1', date, shift: 'day' });
      adminAction(s, now, { type: 'confirm', factoryId: 'f1', date, shift: 'day' });
      const me = s.assignments[0].personId;
      return { me, view: JSON.stringify(workerView(s, now, me)), others: s.people.filter((p) => p.id !== me).map((p) => [p.name, p.phone]) };
    });
    for (const [name, phone] of out.others) {
      expect(out.view.includes(phone)).toBe(false);
      expect(out.view.includes(`"${name}"`)).toBe(false);
    }
    expect(JSON.parse(out.view).today.status).toBe('work');
  });

  it('허용된 동작만 받고, 배치 수정은 못 한다', async () => {
    await mutate(DEMO_COMPANY, (s, now) => {
      const me = s.assignments[0].personId;
      for (const type of ['autoAssign', 'confirm', 'placeManual', 'personSave', 'settingsSave', 'replace']) {
        expect(() => workerAction(s, now, me, { type, personId: s.people[5].id })).toThrow('허용되지 않은 동작');
      }
    });
  });

  it('「오늘 못 나와요」 → 관리자 화면에 결근 카드와 추천, 「잘못 눌렀어요」로 취소', async () => {
    await mutate(DEMO_COMPANY, (s, now) => {
      const { date } = seoul(now);
      const a = s.assignments.find((x) => x.postId === 'f1-L3')!;
      expect(workerView(s, now, a.personId)!.today).toMatchObject({ canReport: true, placed: 'post' });
      workerAction(s, now, a.personId, { type: 'report' });
      const card = boardView(s, now, { factoryId: 'f1', date, shift: 'day' }).absences[0];
      expect(card).toMatchObject({ personId: a.personId, status: 'decided', postCode: 'L-3' });
      expect(card.candidates.length).toBeGreaterThan(0);
      expect(workerView(s, now, a.personId)!.today).toMatchObject({ status: 'absent', canUndo: true, canReport: false });
      workerAction(s, now, a.personId, { type: 'undo' });
      expect(s.absences).toHaveLength(0);
      expect(workerView(s, now, a.personId)!.today.status).toBe('work');
    });
  });

  it('교대가 시작된 뒤에는 결근 신고를 받지 않는다', async () => {
    await mutate(DEMO_COMPANY, (s, now) => {
      const a = s.assignments.find((x) => x.postId === 'f1-L4')!;
      const late = seoulMs(seoul(now).date, '08:00'); // 주간 교대(07:00)가 시작된 뒤
      expect(workerView(s, late, a.personId)!.today.canReport).toBe(false);
      expect(() => workerAction(s, late, a.personId, { type: 'report' })).toThrow('이미 시작');
    });
  });
});

describe('엑셀 가져오기 · 데모 초기화', () => {
  it('직원 명단: 사번 기준 등록·수정, 퇴사일, 라인 코드 열 = 숙련도. 모르는 값은 행 오류', async () => {
    const r = await mutate(DEFAULT_COMPANY, (s, now) => adminAction(s, now, {
      type: 'importPeople',
      rows: [
        { 사번: 'SH9001', 이름: '김시험', 조: 'C', 공장: '1공장', 'L-1': '3' },
        { 사번: 'SH9100', 이름: '박신규', 소속: '협력사', 조: '주간', 역할: '운반', 성별: '여', 전화: '010-9999-0000', 공장: '2공장', 언어: '베트남어', 입사일: '2026.3.2', 지정자리: 'MV', 'S-1': '숙련' },
        { 사번: 'SH9101', 이름: '최퇴사', 조: 'A', 공장: '1공장', 퇴사일: '2026-10-31' },
        { 사번: 'SH9102', 이름: '오류', 공장: '3공장' },
      ],
    })) as { created: number; updated: number; errors: string[] };
    expect(r).toMatchObject({ created: 2, updated: 1 });
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain('5행');
    const people = await read(DEFAULT_COMPANY, (s) => s.people);
    expect(people.find((p) => p.empNo === 'SH9001')).toMatchObject({ crew: 'C', skills: { 'f1-L1': 3 }, phone: '010-1234-5678' });
    expect(people.find((p) => p.empNo === 'SH9100')).toMatchObject({
      crew: 'DAY', role: '운반', gender: 'F', lang: 'vi', factoryId: 'f2', hiredAt: '2026-03-02', fixedPostId: 'f2-MV', affiliation: '협력사',
    });
    expect(people.find((p) => p.empNo === 'SH9101')).toMatchObject({ active: false, leftAt: '2026-10-31' });
  });

  it('생산계획: 제품은 마스터에 있는 코드·이름만 받는다(자유 입력 금지)', async () => {
    const r = await mutate(DEFAULT_COMPANY, (s, now) => adminAction(s, now, {
      type: 'importPlan',
      rows: [
        { 날짜: '2026-12-01', 교대: '주간', 공장: '1공장', 라인: 'L-1', 제품: 'P-007', 상태: '가동' },
        { 날짜: '2026-12-01', 교대: '야간', 공장: '1공장', 라인: 'L-2', 제품: '', 상태: '쉼' },
        { 날짜: '2026-12-01', 교대: '주간', 공장: '1공장', 라인: 'L-3', 제품: '생수500', 상태: '가동' },
      ],
    })) as { saved: number; errors: string[] };
    expect(r.saved).toBe(2);
    expect(r.errors[0]).toContain('제품 마스터에 없는');
  });

  it('데모 초기화는 체험 회사에서만 되고, 배치 없는 처음 상태로 돌아간다', async () => {
    await expect(resetDemo(DEFAULT_COMPANY)).rejects.toThrow('체험 회사');
    expect(await read(DEMO_COMPANY, (s) => s.assignments.length)).toBeGreaterThan(0);
    await resetDemo(DEMO_COMPANY);
    expect(await read(DEMO_COMPANY, (s) => [s.assignments.length, s.absences.length, s.boards.length])).toEqual([0, 0, 0]);
  });

  it('체험 회사는 실제 회사의 공장 구조를 쓰되 이름·사번·전화번호는 가상이다', async () => {
    const real = await read(DEFAULT_COMPANY, (s) => ({
      active: s.people.filter((p) => p.active),
      posts: s.posts.map((p) => p.id).sort(),
      products: s.products.map((p) => p.name).sort(),
    }));
    expect(real.active.length).toBeGreaterThan(0);
    const demo = await read(DEMO_COMPANY, (s) => ({
      people: s.people,
      posts: s.posts.map((p) => p.id).sort(),
      products: s.products.map((p) => p.name).sort(),
    }));
    expect(demo.posts).toEqual(real.posts);
    expect(demo.products).toEqual(real.products);
    expect(demo.people).toHaveLength(real.active.length);
    const realNames = new Set(real.active.map((p) => p.name));
    const realPhones = new Set(real.active.map((p) => p.phone).filter(Boolean));
    const realEmp = new Set(real.active.map((p) => p.empNo));
    for (const p of demo.people) {
      expect(realNames.has(p.name)).toBe(false);
      expect(realPhones.has(p.phone)).toBe(false);
      expect(realEmp.has(p.empNo)).toBe(false);
    }
    // 조·역할 구성은 같다
    const shape = (list: { crew: string; role: string; factoryId: string }[]) => list.map((p) => `${p.factoryId}/${p.crew}/${p.role}`).sort();
    expect(shape(demo.people)).toEqual(shape(real.active));
  });
});
