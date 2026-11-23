'use client';
// 관리 → 제품 · 라인: 제품 마스터(코드로만 선택하게), 공장별 라인·고정 자리, 관리자 비밀번호 바꾸기.
// 제품별 필요 인원은 배치 화면·생산계획에서 − / + 로 정한다. (아웃소싱 업체는 「아웃소싱」 메뉴에 있다)
import { useEffect, useState } from 'react';
import { get, type Any } from '../client';
import type { TabProps } from './page';
import { LINE_ROLE, ROLES } from '@/lib/labels';

export default function Master({ act, refresh, say, me }: TabProps) {
  const [d, setD] = useState<Any>(null);
  const [factory, setFactory] = useState('');
  const [prod, setProd] = useState<Any>(null);
  const [post, setPost] = useState<Any>(null);
  const [pw, setPw] = useState({ current: '', next: '' });

  useEffect(() => {
    get('/api/admin/master').then((r) => { setD(r); setFactory((f) => f || r.factories[0]?.id || ''); }).catch((e) => say(e.message, true));
  }, [refresh, say]);
  if (!d) return <div className="loading">불러오는 중</div>;

  const posts = d.posts.filter((p: Any) => p.factoryId === factory);

  return (
    <div style={{ maxWidth: 1100 }}>
      <div className="toolbar">
        <h1 style={{ fontSize: 20 }}>제품 · 라인</h1>
        <span className="muted">새 제품이 생기거나 라인이 바뀔 때만 고칩니다. · 저장소: {me.storage?.kind === 'supabase' ? 'Supabase' : '이 컴퓨터의 파일'}</span>
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
          <p className="muted" style={{ fontSize: 13 }}>배치 화면·생산계획·엑셀 생산계획은 여기 있는 제품만 고를 수 있습니다. 제품별 필요 인원은 배치 화면이나 생산계획에서 − / + 로 정합니다.</p>
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
