'use client';
// 근로자 관리: 신규 입사 등록, 수정, 퇴사 처리(기록은 남김)·복직·완전 삭제, 숙련도 표, 로그인 잠금 풀기.
import { useEffect, useState } from 'react';
import { get, type Any } from '../client';
import type { TabProps } from './page';
import { CREW_SHORT, LINE_ROLE, ROLES, SKILL_NAME, SKILL_SHORT } from '@/lib/labels';

const CREWS = ['A', 'B', 'C', 'DAY'] as const;
const AFFS = ['직영', '협력사', '임시'];

/** 숙련도 0~3: 직접 정한 값이 우선, 없으면 고정 자리는 지정·역할로, 라인은 근무 이력으로 */
function levelOf(p: Any, post: Any): number {
  const manual = p.skills?.[post.id];
  if (manual !== undefined && manual !== null) return manual;
  if (post.kind === 'fixed') return p.fixedPostId === post.id ? 3 : p.role === post.role ? 2 : 0;
  const n = p.experience?.[post.id] ?? 0;
  return n >= 30 ? 3 : n >= 10 ? 2 : n >= 1 ? 1 : 0;
}

export default function People({ act, refresh, say, go }: TabProps) {
  const [d, setD] = useState<Any>(null);
  const [view, setView] = useState<'list' | 'matrix'>('list');
  const [status, setStatus] = useState<'active' | 'left' | 'all'>('active');
  const [factory, setFactory] = useState('');
  const [find, setFind] = useState('');
  const [edit, setEdit] = useState<Any>(null);

  useEffect(() => {
    get('/api/admin/people').then((r) => { setD(r); setFactory((f) => f || r.factories[0]?.id || ''); }).catch((e) => say(e.message, true));
  }, [refresh, say]);
  if (!d) return <div className="loading">불러오는 중</div>;

  const list = d.people
    .filter((p: Any) => status === 'all' || (status === 'active' ? p.active : !p.active))
    .filter((p: Any) => p.factoryId === factory)
    .filter((p: Any) => !find || p.name.includes(find) || p.empNo.includes(find));
  const active = d.people.filter((p: Any) => p.active).length;
  const posts = d.posts.filter((p: Any) => p.factoryId === factory && !p.unmanned);

  return (
    <div>
      <div className="toolbar">
        <h1 style={{ fontSize: 20 }}>근로자 관리</h1>
        <span className="muted">재직 {active}명 · 퇴사 {d.people.length - active}명</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <a className="btn" href="#import" onClick={(e) => { e.preventDefault(); go('import'); }}>엑셀 일괄 등록</a>
          <button className="btn btn-primary" onClick={() => setEdit('new')}>신규 입사자 등록</button>
        </span>
      </div>
      <div className="toolbar">
        <div className="seg">
          <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>명단</button>
          <button className={view === 'matrix' ? 'on' : ''} onClick={() => setView('matrix')}>숙련도 표</button>
        </div>
        <div className="seg">
          {d.factories.map((f: Any) => (
            <button key={f.id} className={factory === f.id ? 'on' : ''} onClick={() => setFactory(f.id)}>{f.name}</button>
          ))}
        </div>
        <div className="seg">
          <button className={status === 'active' ? 'on' : ''} onClick={() => setStatus('active')}>재직</button>
          <button className={status === 'left' ? 'on' : ''} onClick={() => setStatus('left')}>퇴사</button>
          <button className={status === 'all' ? 'on' : ''} onClick={() => setStatus('all')}>전체</button>
        </div>
        <input className="hr-search" placeholder="이름·사번 찾기" value={find} onChange={(e) => setFind(e.target.value)} />
      </div>

      {view === 'list' ? (
        <div className="table-scroll">
          <table className="grid">
            <thead>
              <tr><th>사번</th><th>이름</th><th>조</th><th>소속 · 역할</th><th>입사일</th><th>주요 숙련</th><th>상태</th><th style={{ width: 210 }} /></tr>
            </thead>
            <tbody>
              {list.map((p: Any) => {
                const top = posts.map((post: Any) => ({ post, lv: levelOf(p, post) })).filter((x: Any) => x.lv >= 2).sort((a: Any, b: Any) => b.lv - a.lv).slice(0, 3);
                return (
                  <tr key={p.id} style={{ opacity: p.active ? 1 : 0.6 }}>
                    <td>{p.empNo}</td>
                    <td><strong>{p.name}</strong>{d.locked.includes(p.id) && <span className="badge badge-danger" style={{ marginLeft: 6 }}>잠김</span>}</td>
                    <td>{CREW_SHORT[p.crew as 'A'] ?? p.crew}</td>
                    <td>{p.affiliation} · {p.role}{p.fixedPostId ? ' (지정)' : ''}</td>
                    <td>{p.hiredAt || '-'}</td>
                    <td>
                      {top.length ? top.map((x: Any) => <span key={x.post.id} className={`lv lv-${x.lv}`}>{x.post.code} {SKILL_SHORT[x.lv]}</span>) : <span className="muted">-</span>}
                    </td>
                    <td>{p.active ? <span className="badge badge-ok">재직</span> : <span className="badge">퇴사 {p.leftAt}</span>}</td>
                    <td>
                      <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button className="btn btn-sm" onClick={() => setEdit(p)}>수정</button>
                        {p.active ? (
                          <button className="btn btn-sm" onClick={() => {
                            const day = prompt(`${p.name} 님 퇴사일 (YYYY-MM-DD)`, d.today);
                            if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) void act({ type: 'personRetire', id: p.id, date: day });
                          }}>퇴사 처리</button>
                        ) : (
                          <>
                            <button className="btn btn-sm" onClick={() => act({ type: 'personRehire', id: p.id })}>복직</button>
                            <button className="btn btn-sm danger-text" onClick={() => confirm(`${p.name} 님을 완전히 삭제할까요?\n근무·결근·휴무 기록도 함께 지워지고 되돌릴 수 없습니다.`) && void act({ type: 'personDelete', id: p.id })}>삭제</button>
                          </>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {!list.length && <tr><td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 24 }}>해당하는 근로자가 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <p className="muted" style={{ margin: '0 0 10px', fontSize: 13 }}>
            칸을 누르면 숙련도가 바뀝니다: - 없음 → 초급(보조 필요) → 중급(단독 가능) → 숙련(지도 가능). 대체 인력 추천과 자동 배치에 바로 반영됩니다.
          </p>
          <div className="table-scroll">
            <table className="grid matrix">
              <thead>
                <tr><th>이름</th>{posts.map((post: Any) => <th key={post.id} title={post.name}>{post.code}</th>)}</tr>
              </thead>
              <tbody>
                {list.map((p: Any) => (
                  <tr key={p.id}>
                    <td><strong>{p.name}</strong> <span className="muted">{CREW_SHORT[p.crew as 'A'] ?? p.crew}</span></td>
                    {posts.map((post: Any) => {
                      const lv = levelOf(p, post);
                      return (
                        <td key={post.id}>
                          <button className={`lv-cell lv-${lv}`} title={`${post.code} · ${SKILL_NAME[lv]}`}
                            onClick={() => act({ type: 'skillSet', personId: p.id, postId: post.id, level: (lv + 1) % 4 })}>{SKILL_SHORT[lv]}</button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {edit && <PersonDialog d={d} person={edit === 'new' ? null : edit} defaultFactory={factory} act={act} onClose={() => setEdit(null)} />}
    </div>
  );
}

function PersonDialog({ d, person, defaultFactory, act, onClose }: { d: Any; person: Any; defaultFactory: string; act: TabProps['act']; onClose: () => void }) {
  const [f, setF] = useState<Any>(() => person ? {
    empNo: person.empNo, name: person.name, affiliation: person.affiliation, crew: person.crew, role: person.role, gender: person.gender || 'F',
    phone: person.phone, factoryId: person.factoryId, lang: person.lang, hiredAt: person.hiredAt, fixedPostId: person.fixedPostId ?? '',
    skills: Object.fromEntries(d.posts.filter((p: Any) => p.factoryId === person.factoryId).map((p: Any) => [p.id, levelOf(person, p)])),
  } : {
    empNo: d.nextEmpNo, name: '', affiliation: '협력사', crew: 'A', role: LINE_ROLE, gender: 'F', phone: '',
    factoryId: defaultFactory, lang: 'ko', hiredAt: d.today, fixedPostId: '', skills: {},
  });
  const [err, setErr] = useState('');
  const set = (k: string, v: Any) => setF((x: Any) => ({ ...x, [k]: v }));
  const posts = d.posts.filter((p: Any) => p.factoryId === f.factoryId && !p.unmanned);
  const locked = person && d.locked.includes(person.id);

  return (
    <div className="popover" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginBottom: 12 }}>{person ? `${person.name} 정보 수정` : '신규 입사자 등록'}</h3>
        <div className="form-grid">
          <label>사번<input value={f.empNo} onChange={(e) => set('empNo', e.target.value)} /></label>
          <label>이름<input value={f.name} onChange={(e) => set('name', e.target.value)} autoFocus={!person} /></label>
          <label>공장
            <select value={f.factoryId} onChange={(e) => set('factoryId', e.target.value)}>
              {d.factories.map((x: Any) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </label>
          <label>조
            <select value={f.crew} onChange={(e) => set('crew', e.target.value)}>
              {CREWS.map((c) => <option key={c} value={c}>{c === 'DAY' ? '주간 고정' : `${c}조`}</option>)}
            </select>
          </label>
          <label>소속
            <select value={f.affiliation} onChange={(e) => set('affiliation', e.target.value)}>{AFFS.map((x) => <option key={x}>{x}</option>)}</select>
          </label>
          <label>역할
            <select value={f.role} onChange={(e) => set('role', e.target.value)}>{ROLES.map((x) => <option key={x}>{x}</option>)}</select>
          </label>
          <label>성별
            <select value={f.gender} onChange={(e) => set('gender', e.target.value)}><option value="F">여</option><option value="M">남</option></select>
          </label>
          <label>전화<input value={f.phone} onChange={(e) => set('phone', e.target.value)} placeholder="010-0000-0000" /></label>
          <label>입사일<input type="date" value={f.hiredAt ?? ''} onChange={(e) => set('hiredAt', e.target.value)} /></label>
          <label>지정 자리
            <select value={f.fixedPostId ?? ''} onChange={(e) => set('fixedPostId', e.target.value)}>
              <option value="">없음</option>
              {d.posts.filter((p: Any) => p.factoryId === f.factoryId && p.kind === 'fixed').map((p: Any) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}
            </select>
          </label>
        </div>
        <div className="dlg-label" style={{ marginTop: 16 }}>숙련도 (Skill Matrix)</div>
        <div className="skill-edit">
          {posts.map((p: Any) => {
            const lv = f.skills?.[p.id] ?? 0;
            return (
              <div key={p.id} className="skill-row">
                <span title={p.name}><strong>{p.code}</strong> <span className="muted">{p.name}</span></span>
                <div className="seg seg-sm">
                  {[0, 1, 2, 3].map((n) => (
                    <button key={n} type="button" className={lv === n ? 'on' : ''} onClick={() => set('skills', { ...f.skills, [p.id]: n })}>{SKILL_SHORT[n]}</button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        {person && (
          <div className="account-box">
            <div className="dlg-label">로그인</div>
            <div className="account-row">
              <span>
                사번 <strong>{person.empNo}</strong> + 비밀번호 (처음에는 전화번호 뒤 4자리 <strong>{person.phone.replace(/\D/g, '').slice(-4) || '-'}</strong>)
                {locked && <span className="badge badge-danger" style={{ marginLeft: 8 }}>잠김 (5번 틀림)</span>}
              </span>
              <button className="btn btn-sm" title="잠금을 풀고 비밀번호를 전화번호 뒤 4자리로 되돌립니다"
                onClick={() => act({ type: 'unlock', personId: person.id }, '잠금을 풀고 비밀번호를 처음 값으로 되돌렸습니다.')}>
                {locked ? '잠금 풀기' : '비밀번호 초기화'}
              </button>
            </div>
          </div>
        )}
        {err && <div className="login-err" style={{ marginTop: 10 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>닫기</button>
          <button className="btn btn-primary" onClick={async () => {
            if (!f.name.trim()) return setErr('이름을 적어 주세요');
            if (!f.empNo.trim()) return setErr('사번을 적어 주세요');
            if (await act({ type: 'personSave', id: person?.id, ...f })) onClose();
          }}>{person ? '저장' : '등록'}</button>
        </div>
      </div>
    </div>
  );
}
