'use client';
// 첫 화면. 왼쪽은 로그인(관리자 = admin + 비밀번호, 근무자 = 사번 + 비밀번호),
// 오른쪽은 체험 회사 전용 「저장된 체험 계정」. 체험 계정은 실제 회사 데이터에 닿지 않는다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { get, post, qs, type Any } from './client';
import { CREW_LABEL, LANG_LABEL } from '@/lib/labels';

interface Acc {
  id: string;
  password: string;
  kind: 'admin' | 'worker';
  role: 'admin' | 'working' | 'sub1' | 'sub2';
  title: string;
  desc: string;
}
// 체험 계정의 비밀번호는 화면 연출용이다. 서버는 체험 회사에서 비밀번호를 확인하지 않는다.
const DEMO_PW = '1234';
const ACCOUNTS: Acc[] = [
  { id: 'admin', password: DEMO_PW, kind: 'admin', role: 'admin', title: '관리자', desc: '자동 배치 → 확정, 대체 인력 요청' },
  { id: 'worker1', password: DEMO_PW, kind: 'worker', role: 'working', title: '오늘 근무', desc: '「오늘 못 나와요」 결근 신고' },
  { id: 'worker2', password: DEMO_PW, kind: 'worker', role: 'sub1', title: '오늘 휴무', desc: '대체 요청을 받고 수락' },
  { id: 'worker3', password: DEMO_PW, kind: 'worker', role: 'sub2', title: '오늘 휴무', desc: '대체 요청을 받고 수락' },
];

const INITIALS = ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const BASE: Record<string, string> = { ㄲ: 'ㄱ', ㄸ: 'ㄷ', ㅃ: 'ㅂ', ㅆ: 'ㅅ', ㅉ: 'ㅈ' };

function initialOf(name: string) {
  const c = name.charCodeAt(0) - 0xac00;
  if (c < 0 || c > 11171) return '기타';
  const ch = CHO[Math.floor(c / 588)];
  return BASE[ch] ?? ch;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const crewText = (p: Any) => (p.crew ? ` · ${CREW_LABEL[p.crew as 'A']}` : '');

export default function Home() {
  const [demoOn, setDemoOn] = useState<boolean | null>(null);
  const [company, setCompany] = useState('');
  const [picking, setPicking] = useState(false);
  const [people, setPeople] = useState<Any[] | null>(null);
  const [cast, setCast] = useState<Any>(null);
  const [initial, setInitial] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [pressing, setPressing] = useState(false);
  const typing = useRef(0);

  const loadRoster = useCallback(() => {
    get('/api/roster')
      .then((r) => { setPeople(r.people); setCast(r.cast); })
      // 서버가 알려 준 원인(예: 환경 변수 없음)을 그대로 보여 준다
      .catch((e) => { setPeople((p) => p ?? []); setErr((e as Error).message); });
  }, []);

  useEffect(() => {
    setCompany(new URLSearchParams(window.location.search).get('company') ?? '');
    let on = false;
    get('/api/me').then((m) => {
      on = !!m.demoEnabled;
      setDemoOn(on);
      if (on) loadRoster();
    }).catch(() => setDemoOn(false));
    // 화면으로 돌아올 때마다 그날 배역을 다시 받는다.
    const again = () => { if (on && document.visibilityState === 'visible') loadRoster(); };
    document.addEventListener('visibilitychange', again);
    window.addEventListener('pageshow', again);
    return () => {
      document.removeEventListener('visibilitychange', again);
      window.removeEventListener('pageshow', again);
    };
  }, [loadRoster]);

  const rows = useMemo(() => ACCOUNTS.map((acc) => ({
    acc,
    person: acc.role === 'working' ? cast?.worker1 : acc.role === 'sub1' ? cast?.offWorkers?.[0] : acc.role === 'sub2' ? cast?.offWorkers?.[1] : undefined,
  })), [cast]);
  const shiftLabel = cast?.shift === 'night' ? '야간' : '주간';

  // 체험 회사에 들어가기
  async function enter(kind: 'admin' | 'worker', personId: string | undefined, mark: string) {
    setBusy(mark);
    setErr('');
    try {
      await post('/api/enter', { role: kind, id: personId });
      window.location.href = kind === 'admin'
        ? (cast ? `/admin?${qs({ shift: cast.shift, factory: cast.factoryId, date: cast.date })}` : '/admin')
        : '/worker';
    } catch (e) {
      setErr((e as Error).message);
      setBusy(null);
      setPressing(false);
    }
  }

  // 저장된 체험 계정을 누르면 아이디·비밀번호가 자동으로 입력되고 바로 로그인된다.
  async function pressSaved(acc: Acc, person: Any) {
    if (busy) return;
    if (acc.kind === 'worker' && !person) { setErr('명단을 불러오는 중입니다. 잠시 후 다시 눌러 주세요.'); return; }
    const run = ++typing.current;
    setBusy(acc.id);
    setErr('');
    setId('');
    setPw('');
    for (let n = 1; n <= acc.id.length; n++) {
      if (typing.current !== run) return;
      setId(acc.id.slice(0, n));
      await sleep(45);
    }
    for (let n = 1; n <= acc.password.length; n++) {
      if (typing.current !== run) return;
      setPw(acc.password.slice(0, n));
      await sleep(45);
    }
    setPressing(true);
    await sleep(180);
    await enter(acc.kind, person?.id, acc.id);
  }

  // 로그인 버튼: 체험 계정 아이디면 체험 회사로, 아니면 실제 로그인
  async function login(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const key = id.trim().toLowerCase();
    const saved = demoOn && !company ? rows.find((r) => r.acc.id === key && r.acc.password === pw && r.acc.kind === 'worker') : undefined;
    if (saved) {
      if (!saved.person) { setErr('명단을 불러오는 중입니다. 잠시 후 다시 시도해 주세요.'); return; }
      setPressing(true);
      await enter('worker', saved.person.id, saved.acc.id);
      return;
    }
    if (!key || !pw) { setErr('아이디와 비밀번호를 입력해 주세요.'); return; }
    setBusy('login');
    setErr('');
    setPressing(true);
    try {
      const r = await post('/api/login', { company: company || undefined, role: key === 'admin' ? 'admin' : 'worker', id: id.trim(), password: pw });
      window.location.href = r.role === 'admin' ? '/admin' : '/worker';
    } catch (e2) {
      setErr((e2 as Error).message);
      setBusy(null);
      setPressing(false);
    }
  }

  const shown = useMemo(() => (people ?? []).filter((p) => !initial || initialOf(p.name) === initial), [people, initial]);
  const has = useMemo(() => new Set((people ?? []).map((p) => initialOf(p.name))), [people]);
  const dup = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of people ?? []) m.set(p.name, (m.get(p.name) ?? 0) + 1);
    return m;
  }, [people]);

  if (picking) {
    return (
      <main className="entry entry-pick">
        <div className="pick-head">
          <button className="btn" onClick={() => { setPicking(false); setInitial(null); setErr(''); }}>← 처음으로</button>
          <h1>내 이름을 누르세요</h1>
        </div>
        <div className="pick-initials" role="group" aria-label="이름 첫 글자">
          <button className={`chip ${initial === null ? 'on' : ''}`} onClick={() => setInitial(null)}>전체</button>
          {INITIALS.map((c) => (
            <button key={c} className={`chip ${initial === c ? 'on' : ''}`} disabled={!has.has(c)} onClick={() => setInitial(c)}>{c}</button>
          ))}
        </div>
        {err && <div className="login-err">{err}</div>}
        {people === null ? <div className="loading">명단을 불러오는 중…</div>
          : shown.length === 0 ? <div className="loading">명단이 없습니다. 관리자에게 알려 주세요.</div>
            : (
              <div className="pick-list">
                {shown.map((p) => (
                  <button key={p.id} className="pick-name" disabled={busy !== null} onClick={() => enter('worker', p.id, p.id)}>
                    <strong>{p.name}</strong>
                    <span className={dup.get(p.name)! > 1 ? 'dup' : ''}>{p.factory}{crewText(p)}</span>
                    {busy === p.id && <em>들어가는 중…</em>}
                  </button>
                ))}
              </div>
            )}
      </main>
    );
  }

  return (
    <main className="entry">
      <div className="entry-head">
        <h1>새한 프라텍</h1>
        <p>생산계획에 맞춘 인원 배치</p>
      </div>
      <div className="demo-login" style={demoOn === false ? { gridTemplateColumns: 'minmax(0, 420px)' } : undefined}>
        <form className="login-card demo-form" onSubmit={login}>
          <h2>로그인</h2>
          <label>
            아이디
            <input value={id} onChange={(e) => setId(e.target.value)} autoComplete="username" disabled={busy !== null} placeholder="아이디" />
          </label>
          <label>
            비밀번호
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" disabled={busy !== null} placeholder="비밀번호" />
          </label>
          <button type="submit" className={`btn btn-primary login-btn ${pressing ? 'pressing' : ''}`} disabled={busy !== null && !pressing}>
            {busy ? '로그인 중…' : '로그인'}
          </button>
          {err && <div className="login-err">{err}</div>}
        </form>

        {demoOn && (
          <section className="saved-box" aria-label="저장된 체험 계정">
            <h2>저장된 체험 계정</h2>
            <p className="saved-hint">누르면 아이디·비밀번호가 자동으로 입력되고 바로 로그인됩니다. 근무자는 날짜마다 그날 맞는 사람으로 바뀝니다.</p>
            <div className="saved-list">
              {rows.map(({ acc, person }) => {
                const loading = acc.kind === 'worker' && people === null;
                const none = acc.kind === 'worker' && people !== null && !person;
                if (acc.kind === 'worker' && acc.role !== 'working' && cast && !cast.placed) {
                  return (
                    <div key={acc.id} className="saved-item worker pending" aria-disabled="true">
                      <span className="saved-role">{acc.title}</span>
                      <span className="saved-main"><strong>자동 배치 후 정해집니다</strong><em className="saved-do">{acc.desc}</em></span>
                      <span className="saved-cred">{acc.id}<br />••••</span>
                    </div>
                  );
                }
                if (none) return null;
                const before = acc.role === 'working' && cast && !cast.placed;
                return (
                  <button key={acc.id} type="button" className={`saved-item ${acc.kind} ${busy === acc.id ? 'on' : ''}`} disabled={busy !== null || loading} onClick={() => pressSaved(acc, person)}>
                    <span className="saved-role">{acc.title}</span>
                    <span className="saved-main">
                      <strong>{acc.kind === 'admin' ? '관리자 계정' : person?.name ?? '불러오는 중…'}</strong>
                      <em>
                        {acc.kind === 'admin'
                          ? `${acc.desc} · 오늘 ${shiftLabel}`
                          : person ? `${person.factory}${crewText(person)} · ${LANG_LABEL[person.lang] ?? ''} 화면` : ''}
                      </em>
                      {acc.kind === 'worker' && person && <em className="saved-do">{before ? '관리자가 자동 배치 → 확정한 뒤 결근 신고' : acc.desc}</em>}
                    </span>
                    <span className="saved-cred">{acc.id}<br />••••</span>
                  </button>
                );
              })}
            </div>
            {cast && cast.placed && cast.offWorkers.length === 0 && (
              <p className="saved-hint">오늘 휴무 근무자를 고르지 못했습니다. 관리자로 들어가 오른쪽 위 「데모 초기화」를 누른 뒤 처음부터 해 주세요.</p>
            )}
            <ol className="demo-steps" aria-label="시연 순서">
              <li><b>관리자</b> 데모 초기화 → 자동 배치 → 확정</li>
              <li><b>오늘 근무</b> 「오늘 못 나와요」</li>
              <li><b>관리자</b> 빈자리 추천에서 휴무 근무자에게 「요청」</li>
              <li><b>오늘 휴무</b> 「갈 수 있어요」 → 배치표 복구</li>
            </ol>
            <button type="button" className="w-link saved-more" disabled={busy !== null} onClick={() => setPicking(true)}>
              다른 근무자로 들어가기 (명단에서 이름 찾기) →
            </button>
          </section>
        )}
      </div>
    </main>
  );
}
