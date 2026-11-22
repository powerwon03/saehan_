'use client';
// 설정: 회사가 직접 정하는 값 — 교대 시간, 인정 시간, 주 최대 근로시간, 요청 기한, 배치 점수 가중치,
// 숙련도별 가동률, 교대 달력(주기·조별 시작·공장별 기준일), 관리자 비밀번호.
import { useEffect, useRef, useState } from 'react';
import { get, type Any } from '../client';
import type { TabProps } from './page';
import { CREW_LABEL, WEEKDAY, md } from '@/lib/labels';
import { dow } from '@/lib/dates';

const W: [string, string][] = [
  ['samePost', '최근 같은 자리'], ['sameProduct', '같은 제품 경험'], ['sameFactory', '같은 공장'], ['roleMatch', '역할 일치'], ['recentSub', '최근 대체 1회당 감점'],
];
const SKILLS = ['없음', '초급', '중급', '숙련'];

export default function SettingsTab({ act, refresh, say, me }: TabProps) {
  const [d, setD] = useState<Any>(null);
  const [s, setSRaw] = useState<Any>(null);
  const [fs, setFsRaw] = useState<Any[]>([]);
  const [pw, setPw] = useState({ current: '', next: '' });
  const dirty = useRef(false);
  const setS = (v: Any) => { dirty.current = true; setSRaw(v); };
  const setFs = (v: Any[]) => { dirty.current = true; setFsRaw(v); };

  useEffect(() => {
    get('/api/admin/master').then((r) => {
      setD(r);
      // 고치는 중에는 다른 사람의 변경으로 입력이 지워지지 않게 한다.
      if (!dirty.current) { setSRaw(r.settings); setFsRaw(r.factories); }
    }).catch((e) => say(e.message, true));
  }, [refresh, say]);
  if (!d || !s) return <div className="loading">불러오는 중</div>;

  const num = (k: string) => (e: Any) => setS({ ...s, [k]: e.target.value });
  const save = async () => {
    dirty.current = false;
    if (!(await act({ type: 'settingsSave', settings: s, factories: fs }, '설정을 저장했습니다.'))) dirty.current = true;
  };

  return (
    <div style={{ maxWidth: 1100 }}>
      <div className="toolbar">
        <h1 style={{ fontSize: 20 }}>설정</h1>
        <span className="muted">
          저장소: {me.storage?.kind === 'supabase' ? 'Supabase' : '이 컴퓨터의 파일'}
        </span>
        <span style={{ marginLeft: 'auto' }}><button className="btn btn-primary" onClick={save}>설정 저장</button></span>
      </div>

      <div className="cols-2">
        <div className="card panel">
          <h2>근무 시간 · 요청</h2>
          <div className="form-grid">
            <label>주간 시작<input type="time" value={s.dayStart} onChange={num('dayStart')} /></label>
            <label>야간 시작<input type="time" value={s.nightStart} onChange={num('nightStart')} /></label>
            <label>교대 1회 인정 시간<input type="number" value={s.shiftHours} onChange={num('shiftHours')} /></label>
            <label>주 최대 근로시간<input type="number" value={s.maxWeekHours} onChange={num('maxWeekHours')} /></label>
            <label>요청 응답 기한 (분)<input type="number" value={s.expiryMin} onChange={num('expiryMin')} /></label>
            <label>운반 1명 추가 기준 (가동 라인 수)<input type="number" value={s.carryExtraLines} onChange={num('carryExtraLines')} /></label>
          </div>
          <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>주 근로시간 = 그 주(월~일)에 일한 교대 수 × 인정 시간. 넘으면 대체 후보에서 뺍니다.</p>
        </div>

        <div className="card panel">
          <h2>자동 배치 점수</h2>
          <div className="form-grid">
            {W.map(([k, label]) => (
              <label key={k}>{label}
                <input type="number" value={s.weights[k]} onChange={(e) => setS({ ...s, weights: { ...s.weights, [k]: e.target.value } })} />
              </label>
            ))}
          </div>
          <div className="dlg-label" style={{ marginTop: 16 }}>숙련도별 예상 가동률 (%)</div>
          <div className="form-grid cols-4">
            {SKILLS.map((label, i) => (
              <label key={i}>{label}
                <input type="number" value={s.skillRates[i]} onChange={(e) => setS({ ...s, skillRates: s.skillRates.map((x: Any, j: number) => (j === i ? e.target.value : x)) })} />
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="card panel" style={{ marginTop: 16 }}>
        <h2>교대 달력</h2>
        <div className="form-grid cols-3">
          <label style={{ gridColumn: 'span 2' }}>교대 주기 — 하루에 한 글자: D 주간 · N 야간 · O 휴무 (지금 {s.cyclePattern.length}일 주기)
            <input value={s.cyclePattern} onChange={(e) => setS({ ...s, cyclePattern: e.target.value.toUpperCase() })} style={{ fontFamily: 'ui-monospace, monospace', letterSpacing: 2 }} />
          </label>
          <span />
          {['A', 'B', 'C'].map((c) => (
            <label key={c}>{c}조: A조보다 며칠 늦게 시작
              <input type="number" value={s.crewOffsets[c] ?? 0} onChange={(e) => setS({ ...s, crewOffsets: { ...s.crewOffsets, [c]: e.target.value } })} />
            </label>
          ))}
          {fs.map((f, i) => (
            <label key={f.id}>{f.name} 기준일 (A조가 주기 첫날인 날)
              <input type="date" value={f.anchorDate} onChange={(e) => setFs(fs.map((x, j) => (j === i ? { ...x, anchorDate: e.target.value } : x)))} />
            </label>
          ))}
        </div>
        <p className="muted" style={{ fontSize: 13 }}>「주간」조는 평일 주간만 근무합니다. 아래는 저장된 설정으로 계산한 앞으로 14일입니다(바꾼 뒤 「설정 저장」을 누르면 갱신됩니다).</p>
        <div className="table-scroll">
          <table className="cal">
            <thead>
              <tr><th /><th />{d.calendar[0]?.days.map((x: Any) => <th key={x.date}>{md(x.date)}<br />{WEEKDAY[dow(x.date)]}</th>)}</tr>
            </thead>
            <tbody>
              {d.calendar.flatMap((c: Any) => (['day', 'night'] as const).map((sh) => (
                <tr key={c.factoryId + sh}>
                  {sh === 'day' && <th rowSpan={2}>{c.name}</th>}
                  <th>{sh === 'day' ? '주간' : '야간'}</th>
                  {c.days.map((x: Any) => <td key={x.date}>{x[sh].map((k: string) => CREW_LABEL[k as 'A']).join(', ') || '-'}</td>)}
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      </div>

      {!me.session.demo && (
        <div className="card panel" style={{ marginTop: 16, maxWidth: 560 }}>
          <h2>관리자 비밀번호 바꾸기</h2>
          <form className="inline-form" onSubmit={async (e) => {
            e.preventDefault();
            if (await act({ type: 'adminPassword', ...pw }, '비밀번호를 바꿨습니다.')) setPw({ current: '', next: '' });
          }}>
            <input type="password" placeholder="지금 비밀번호" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
            <input type="password" placeholder="새 비밀번호 (8자 이상)" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
            <button className="btn" disabled={!pw.current || pw.next.length < 8}>바꾸기</button>
          </form>
        </div>
      )}
    </div>
  );
}
