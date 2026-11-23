'use client';
// 주 단위 생산계획: 금요일 야간 ~ 다음 금요일 주간(교대 14개). 목요일에 임시로 세우고 금요일에 확정한다.
// 칸을 눌러 제품·쉼·필요 인원을 정한다. 확정 뒤에도 바뀌면 그 칸만 다시 고치면 된다.
import { useCallback, useEffect, useState } from 'react';
import { get, qs, type Any } from '../client';
import type { TabProps } from './page';
import { md } from '@/lib/labels';
import { addDays } from '@/lib/dates';

export default function Plan({ act, refresh, say }: TabProps) {
  const [q, setQ] = useState<{ factory?: string; week?: string }>({});
  const [d, setD] = useState<Any>(null);
  const [edit, setEdit] = useState<{ line: Any; i: number } | null>(null);

  const load = useCallback(() => {
    get(`/api/admin/plan?${qs(q)}`).then(setD).catch((e) => say(e.message, true));
  }, [q, say]);
  useEffect(() => { load(); }, [load, refresh]);

  if (!d) return <div className="loading">불러오는 중…</div>;
  const sel = (patch: Any) => setQ({ factory: d.factoryId, week: d.week, ...patch });

  return (
    <div>
      <div className="toolbar">
        <h1 style={{ fontSize: 20 }}>생산계획</h1>
        <span className="muted">금요일 야간부터 다음 금요일 주간까지 · 목요일 임시 → 금요일 확정</span>
      </div>
      <div className="toolbar">
        <div className="seg">
          {d.factories.map((f: Any) => (
            <button key={f.id} className={d.factoryId === f.id ? 'on' : ''} onClick={() => sel({ factory: f.id })}>{f.name}</button>
          ))}
        </div>
        <button className="btn btn-sm" onClick={() => sel({ week: addDays(d.week, -7) })}>이전 주</button>
        <strong>{md(d.week)}(금) 야간 ~ {md(addDays(d.week, 7))}(금) 주간</strong>
        <button className="btn btn-sm" onClick={() => sel({ week: addDays(d.week, 7) })}>다음 주</button>
        {d.week !== d.thisWeek && <button className="btn btn-sm" onClick={() => sel({ week: d.thisWeek })}>이번 주</button>}
        <span className={`badge ${d.final ? 'badge-ok' : 'badge-warn'}`} style={{ fontSize: 14 }}>{d.final ? '확정' : '임시'}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => confirm('지난주의 같은 요일·교대 계획을 이 주에 그대로 적을까요?\n이 주에 이미 적은 계획은 덮어씁니다.')
            && void act({ type: 'planCopy', factoryId: d.factoryId, week: d.week }, '지난주 계획을 가져왔습니다.')}>지난주와 같게</button>
          {d.final ? (
            <button className="btn" onClick={() => act({ type: 'planWeek', factoryId: d.factoryId, week: d.week, final: false })}>확정 취소</button>
          ) : (
            <button className="btn btn-ok" onClick={() => act({ type: 'planWeek', factoryId: d.factoryId, week: d.week, final: true }, '이 주 생산계획을 확정했습니다.')}>계획 확정</button>
          )}
        </span>
      </div>

      <div className="table-scroll">
        <table className="grid plan">
          <thead>
            <tr>
              <th className="plan-line">라인</th>
              {d.shifts.map((c: Any, i: number) => (
                <th key={i} className={`plan-${c.shift}${c.date === d.today ? ' today' : ''}`}>
                  <div>{c.weekday} {md(c.date)}</div>
                  <div className="plan-shift">{c.shift === 'day' ? '주간' : '야간'}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {d.lines.map((line: Any) => (
              <tr key={line.postId}>
                <td className="plan-line"><strong>{line.code}</strong> <span className="muted">{line.name}</span></td>
                {line.cells.map((c: Any, i: number) => (
                  <td key={i} className={d.shifts[i].past ? 'past' : ''}>
                    <button className={`plan-cell ${c.status === 'off' ? 'off' : ''} ${c.set ? 'set' : ''}`}
                      title={c.set ? '이 교대에 직접 정한 계획' : '앞 계획을 이어받음'} onClick={() => setEdit({ line, i })}>
                      {c.status === 'off' ? '쉼' : (
                        <>
                          <span className="plan-product">{c.product || '제품 미정'}</span>
                          <span className="plan-need">{c.need}명</span>
                        </>
                      )}
                    </button>
                  </td>
                ))}
              </tr>
            ))}
            {!d.lines.length && <tr><td colSpan={15} className="muted" style={{ textAlign: 'center', padding: 24 }}>이 공장에는 사람이 서는 라인이 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>
        칸을 누르면 제품·쉼·필요 인원을 정할 수 있습니다. 흐린 칸은 따로 정하지 않아 앞 계획을 이어받은 교대입니다.
        발주 변경·설비 고장 등으로 계획이 바뀌면 그 칸만 다시 고치세요. 배치 화면에 바로 반영됩니다.
      </p>

      {edit && <CellDialog d={d} line={edit.line} i={edit.i} act={act} onClose={() => setEdit(null)} />}
    </div>
  );
}

function CellDialog({ d, line, i, act, onClose }: { d: Any; line: Any; i: number; act: TabProps['act']; onClose: () => void }) {
  const cell = line.cells[i];
  const shift = d.shifts[i];
  const [status, setStatus] = useState<'run' | 'off'>(cell.status === 'off' ? 'off' : 'run');
  const [productId, setProductId] = useState<string>(cell.productId ?? '');
  const [find, setFind] = useState('');
  // 필요 인원: 직접 바꾸면 그 값, 아니면 이 라인·이 제품의 기준
  const [need, setNeed] = useState<number | null>(null);
  // 처음 정하는 칸은 주 끝까지 같게, 이미 정한 칸은 그 교대만 고치는 것이 기본
  const [range, setRange] = useState<'one' | 'rest'>(cell.set ? 'one' : 'rest');

  const baseNeed = d.standards[`${line.postId}|${productId}`] ?? d.standards[`${line.postId}|`] ?? line.defaultNeed;
  const shownNeed = need ?? baseNeed;
  const word = find.trim().toLowerCase();
  const products = d.products.filter((p: Any) => !word || p.name.toLowerCase().includes(word) || p.code.toLowerCase().includes(word) || p.id === productId);
  const rest = d.shifts.length - i;

  return (
    <div className="popover" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginBottom: 12 }}>
          {line.code} <span className="muted" style={{ fontSize: 14, fontWeight: 500 }}>{line.name}</span>{' · '}
          {shift.weekday} {md(shift.date)} {shift.shift === 'day' ? '주간' : '야간'}
        </h3>
        <div className="seg" style={{ marginBottom: 12 }}>
          <button className={status === 'run' ? 'on' : ''} onClick={() => setStatus('run')}>가동</button>
          <button className={status === 'off' ? 'on' : ''} onClick={() => setStatus('off')}>쉼 (세움)</button>
        </div>
        {status === 'run' && (
          <>
            <div className="dlg-label">제품</div>
            <input className="hr-search" style={{ width: '100%', marginBottom: 6 }} placeholder="제품 이름·코드 찾기" value={find} onChange={(e) => setFind(e.target.value)} />
            <select size={7} value={productId} onChange={(e) => { setProductId(e.target.value); setNeed(null); }} aria-label="제품"
              style={{ width: '100%', padding: 4, borderRadius: 8, border: '1px solid var(--border)' }}>
              <option value="">제품 미정</option>
              {products.map((p: Any) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <div className="dlg-label" style={{ marginTop: 12 }}>필요 인원</div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <span className="need-step big">
                <button aria-label="필요 인원 줄이기" disabled={shownNeed <= 0} onClick={() => setNeed(shownNeed - 1)}>−</button>
                <span>{shownNeed}명</span>
                <button aria-label="필요 인원 늘리기" disabled={shownNeed >= 20} onClick={() => setNeed(shownNeed + 1)}>+</button>
              </span>
              <span className="muted" style={{ fontSize: 13 }}>
                {shownNeed === 0 ? '0명 = 옆 라인 담당자가 함께 봅니다.' : '이 라인에서 이 제품을 만들 때의 기준으로 기억합니다.'}
              </span>
            </div>
          </>
        )}
        <div className="dlg-label" style={{ marginTop: 14 }}>적용할 교대</div>
        <div className="seg">
          <button className={range === 'one' ? 'on' : ''} onClick={() => setRange('one')}>이 교대만</button>
          <button className={range === 'rest' ? 'on' : ''} disabled={rest <= 1} onClick={() => setRange('rest')}>이 교대부터 주 끝까지 ({rest}개)</button>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>닫기</button>
          <button className="btn btn-primary" onClick={async () => {
            const cells = (range === 'rest' ? d.shifts.slice(i) : [shift]).map((c: Any) => ({ date: c.date, shift: c.shift }));
            const ok = await act({
              type: 'planCells', postId: line.postId, cells, status,
              productId: productId || null, need: status === 'run' && need !== null ? need : undefined,
            });
            if (ok) onClose();
          }}>저장</button>
        </div>
      </div>
    </div>
  );
}
