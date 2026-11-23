'use client';
// 기준 정보: 제품 마스터(코드로만 선택하게), 공장별 라인·고정 자리, 표준 인원(라인 × 제품),
// 교대 달력 보기, 관리자 비밀번호 바꾸기. (아웃소싱 업체는 「아웃소싱」 메뉴에 있다)
import { useEffect, useState } from 'react';
import { get, type Any } from '../client';
import type { TabProps } from './page';
import { CREW_LABEL, LINE_ROLE, ROLES, WEEKDAY, md } from '@/lib/labels';
import { dow } from '@/lib/dates';

export default function Master({ act, refresh, say, me }: TabProps) {
  const [d, setD] = useState<Any>(null);
  const [factory, setFactory] = useState('');
  const [prod, setProd] = useState<Any>(null);
  const [post, setPost] = useState<Any>(null);
  const [std, setStd] = useState<Any>({ postId: '', productId: '', need: 1, gender: '' });
  const [pw, setPw] = useState({ current: '', next: '' });

  useEffect(() => {
    get('/api/admin/master').then((r) => { setD(r); setFactory((f) => f || r.factories[0]?.id || ''); }).catch((e) => say(e.message, true));
  }, [refresh, say]);
  if (!d) return <div className="loading">불러오는 중</div>;

  const posts = d.posts.filter((p: Any) => p.factoryId === factory);
  const lines = posts.filter((p: Any) => p.kind === 'line');
  const pname = (id: string | null) => (id ? d.products.find((p: Any) => p.id === id)?.name ?? '(삭제됨)' : '라인 기본 (제품 무관)');
  const stds = d.standards.filter((s: Any) => posts.some((p: Any) => p.id === s.postId));

  return (
    <div style={{ maxWidth: 1100 }}>
      <div className="toolbar">
        <h1 style={{ fontSize: 20 }}>기준 정보</h1>
        <span className="muted">제품·라인·표준 인원을 회사가 직접 정합니다. · 저장소: {me.storage?.kind === 'supabase' ? 'Supabase' : '이 컴퓨터의 파일'}</span>
      </div>
      <div className="toolbar">
        <div className="seg">
          {d.factories.map((f: Any) => (
            <button key={f.id} className={f.id === factory ? 'on' : ''} onClick={() => setFactory(f.id)}>{f.name}</button>
          ))}
        </div>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => setProd({ code: '', name: '', urgent: false, active: true })}>제품 추가</button>
          <button className="btn btn-primary" onClick={() => setPost({ factoryId: factory, code: '', name: '', kind: 'line', role: LINE_ROLE, defaultNeed: 1, priority: 5, unmanned: false, active: true })}>라인 · 자리 추가</button>
        </span>
      </div>

      <div className="cols-2">
        <div>
          <h2 style={{ fontSize: 17, marginBottom: 8 }}>제품 마스터</h2>
          <div className="table-scroll">
            <table className="grid">
              <thead><tr><th>코드</th><th>이름</th><th>긴급</th><th>상태</th><th style={{ width: 70 }} /></tr></thead>
              <tbody>
                {d.products.map((p: Any) => (
                  <tr key={p.id} style={{ opacity: p.active ? 1 : 0.6 }}>
                    <td>{p.code}</td><td><strong>{p.name}</strong></td><td>{p.urgent ? <span className="badge badge-danger">긴급</span> : '-'}</td>
                    <td>{p.active ? <span className="badge badge-ok">사용</span> : <span className="badge">중지</span>}</td>
                    <td><button className="btn btn-sm" onClick={() => setProd(p)}>수정</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ fontSize: 13 }}>배치 화면과 엑셀 생산계획은 여기 있는 제품만 고를 수 있습니다.</p>
        </div>

        <div>
          <h2 style={{ fontSize: 17, marginBottom: 8 }}>라인 · 고정 자리</h2>
          <div className="table-scroll">
            <table className="grid">
              <thead><tr><th>코드</th><th>이름</th><th>종류</th><th>기본 인원</th><th>우선</th><th style={{ width: 70 }} /></tr></thead>
              <tbody>
                {posts.map((p: Any) => (
                  <tr key={p.id} style={{ opacity: p.active ? 1 : 0.6 }}>
                    <td><strong>{p.code}</strong></td><td>{p.name}</td>
                    <td>{p.kind === 'line' ? (p.unmanned ? '라인 (무인)' : '라인') : `고정 · ${p.role}`}{!p.active && ' · 중지'}</td>
                    <td>{p.defaultNeed}</td><td>{p.priority}</td>
                    <td><button className="btn btn-sm" onClick={() => setPost(p)}>수정</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <h2 style={{ fontSize: 17, margin: '20px 0 4px' }}>표준 인원 <span className="muted" style={{ fontSize: 13, fontWeight: 500 }}>라인 × 제품 → 필요 인원</span></h2>
      <p className="muted" style={{ margin: '0 0 10px', fontSize: 13 }}>없는 조합은 라인 기본값, 그것도 없으면 자리의 기본 인원을 씁니다. 성별 조건을 걸 수 있습니다.</p>
      <form className="inline-form" style={{ marginBottom: 10 }} onSubmit={async (e) => { e.preventDefault(); if (std.postId) await act({ type: 'standardSave', ...std }); }}>
        <select value={std.postId} onChange={(e) => setStd({ ...std, postId: e.target.value })} aria-label="라인">
          <option value="">라인 선택…</option>
          {lines.map((l: Any) => <option key={l.id} value={l.id}>{l.code} {l.name}</option>)}
        </select>
        <select value={std.productId} onChange={(e) => setStd({ ...std, productId: e.target.value })} aria-label="제품">
          <option value="">라인 기본 (제품 무관)</option>
          {d.products.filter((p: Any) => p.active).map((p: Any) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input type="number" min={0} max={20} style={{ width: 80 }} value={std.need} onChange={(e) => setStd({ ...std, need: e.target.value })} aria-label="필요 인원" />
        <select value={std.gender} onChange={(e) => setStd({ ...std, gender: e.target.value })} aria-label="성별 조건">
          <option value="">성별 무관</option><option value="F">여</option><option value="M">남</option>
        </select>
        <button className="btn btn-primary" disabled={!std.postId}>추가 · 고치기</button>
      </form>
      <div className="table-scroll">
        <table className="grid">
          <thead><tr><th>라인</th><th>제품</th><th>필요 인원</th><th>성별 조건</th><th style={{ width: 80 }} /></tr></thead>
          <tbody>
            {stds.map((s: Any) => (
              <tr key={s.id}>
                <td><strong>{posts.find((p: Any) => p.id === s.postId)?.code}</strong></td>
                <td>{pname(s.productId)}</td><td>{s.need}명</td><td>{s.gender === 'M' ? '남' : s.gender === 'F' ? '여' : '-'}</td>
                <td><button className="btn btn-sm danger-text" onClick={() => act({ type: 'standardDelete', id: s.id })}>지우기</button></td>
              </tr>
            ))}
            {!stds.length && <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 24 }}>이 공장에는 따로 정한 표준 인원이 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>

      <h2 style={{ fontSize: 17, margin: '24px 0 4px' }}>교대 달력 <span className="muted" style={{ fontSize: 13, fontWeight: 500 }}>앞으로 14일 동안 어느 조가 근무하는지</span></h2>
      <p className="muted" style={{ margin: '0 0 10px', fontSize: 13 }}>
        근무시간 주간 {d.settings.dayStart}~{d.settings.nightStart} · 야간 {d.settings.nightStart}~{d.settings.dayStart}. 「주간」조는 평일 주간만 근무합니다.
      </p>
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

      {!me.session.demo && (
        <>
          <h2 style={{ fontSize: 17, margin: '24px 0 10px' }}>관리자 비밀번호 바꾸기</h2>
          <form className="inline-form" onSubmit={async (e) => {
            e.preventDefault();
            if (await act({ type: 'adminPassword', ...pw }, '비밀번호를 바꿨습니다.')) setPw({ current: '', next: '' });
          }}>
            <input type="password" placeholder="지금 비밀번호" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
            <input type="password" placeholder="새 비밀번호 (8자 이상)" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
            <button className="btn" disabled={!pw.current || pw.next.length < 8}>바꾸기</button>
          </form>
        </>
      )}

      {prod && (
        <Dialog title={prod.id ? `${prod.name} 수정` : '제품 추가'} onClose={() => setProd(null)}
          onSave={async () => { if (await act({ type: 'productSave', ...prod })) setProd(null); }}>
          <label>코드<input value={prod.code} onChange={(e) => setProd({ ...prod, code: e.target.value })} autoFocus={!prod.id} /></label>
          <label>이름<input value={prod.name} onChange={(e) => setProd({ ...prod, name: e.target.value })} /></label>
          <label className="check"><input type="checkbox" checked={prod.urgent} onChange={(e) => setProd({ ...prod, urgent: e.target.checked })} /> 긴급 제품</label>
          <label className="check"><input type="checkbox" checked={prod.active} onChange={(e) => setProd({ ...prod, active: e.target.checked })} /> 사용</label>
        </Dialog>
      )}
      {post && (
        <Dialog title={post.id ? `${post.code} 수정` : '라인 · 자리 추가'} onClose={() => setPost(null)}
          onSave={async () => { if (await act({ type: 'postSave', ...post })) setPost(null); }}>
          <label>코드<input value={post.code} onChange={(e) => setPost({ ...post, code: e.target.value })} autoFocus={!post.id} /></label>
          <label>이름<input value={post.name} onChange={(e) => setPost({ ...post, name: e.target.value })} /></label>
          {!post.id && (
            <label>종류
              <select value={post.kind} onChange={(e) => setPost({ ...post, kind: e.target.value, role: e.target.value === 'line' ? LINE_ROLE : 'OP' })}>
                <option value="line">설비 라인</option><option value="fixed">고정 자리</option>
              </select>
            </label>
          )}
          {post.kind === 'fixed' && (
            <label>역할
              <select value={post.role} onChange={(e) => setPost({ ...post, role: e.target.value })}>{ROLES.filter((r) => r !== LINE_ROLE).map((r) => <option key={r}>{r}</option>)}</select>
            </label>
          )}
          <label>기본 인원<input type="number" min={0} max={20} value={post.defaultNeed} onChange={(e) => setPost({ ...post, defaultNeed: e.target.value })} /></label>
          <label>우선순위 (클수록 먼저 채움)<input type="number" min={0} max={99} value={post.priority} onChange={(e) => setPost({ ...post, priority: e.target.value })} /></label>
          {post.kind === 'line' && <label className="check"><input type="checkbox" checked={post.unmanned} onChange={(e) => setPost({ ...post, unmanned: e.target.checked })} /> 무인 라인 (사람 0명)</label>}
          <label className="check"><input type="checkbox" checked={post.active} onChange={(e) => setPost({ ...post, active: e.target.checked })} /> 사용</label>
        </Dialog>
      )}
    </div>
  );
}

function Dialog({ title, onClose, onSave, children }: { title: string; onClose: () => void; onSave: () => void; children: React.ReactNode }) {
  return (
    <div className="popover" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginBottom: 12 }}>{title}</h3>
        <div className="form-grid">{children}</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>닫기</button>
          <button className="btn btn-primary" onClick={onSave}>저장</button>
        </div>
      </div>
    </div>
  );
}
