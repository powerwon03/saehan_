'use client';
// 배치 화면: 공장·교대·날짜 선택, 요약, 라인별 생산계획과 배치, 자동 배치·확정, 결근 카드와 대체 인력 추천.
import { useCallback, useEffect, useRef, useState } from 'react';
import { get, qs, type Any } from '../client';
import type { TabProps } from './page';
import { FLAG_LABEL, KIND_LABEL, REPORTER_LABEL, md } from '@/lib/labels';
import { addDays } from '@/lib/dates';

const hhmm = (isoStr: string) => new Date(Date.parse(isoStr) + 9 * 3600000).toISOString().slice(11, 16);
const KIND_TEXT: Record<string, string> = { standby: '대기', off: '휴무', other: '휴무' };
const REQ_TEXT: Record<string, string> = { sent: '응답 대기', accepted: '수락', declined: '거절', expired: '응답 없음', cancelled: '취소' };
const WHY: Record<string, string> = { exp: '업무 경험', product: '같은 제품' };
const EXCEPTIONS: [string, string][] = [['absent', '결근'], ['sick', '병가'], ['early', '조퇴'], ['late', '지각']];
const ORDER: Record<string, number> = { failed: 0, decided: 1, 'in-progress': 2, 'pre-board': 2, resolved: 3 };

export default function Board({ act, refresh, say, onPending }: TabProps & { onPending: (n: number) => void }) {
  const [q, setQ] = useState<{ factory?: string; date?: string; shift?: string } | null>(null);
  const [d, setD] = useState<Any>(null);
  const [pick, setPick] = useState<Any>(null);
  const [, setTick] = useState(0);
  const fetchedAt = useRef(0);

  const started = useRef(false);
  useEffect(() => {
    // 체험 관리자 계정은 /admin?shift=…&factory=… 로 열려 그날 시연 교대·공장이 선택된다.
    // 주소의 값은 한 번만 읽고 지운다(개발 모드에서 두 번 실행돼도 값을 잃지 않게).
    if (started.current) return;
    started.current = true;
    const p = new URLSearchParams(window.location.search);
    setQ({ factory: p.get('factory') ?? undefined, date: p.get('date') ?? undefined, shift: p.get('shift') ?? undefined });
    if (p.get('shift')) window.history.replaceState(null, '', window.location.pathname);
  }, []);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 10000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    if (!q) return;
    try {
      const r = await get(`/api/admin/board?${qs(q)}`);
      fetchedAt.current = Date.now();
      setD(r);
      onPending(r.pendingLeaves);
    } catch (e) {
      say((e as Error).message, true);
    }
  }, [q, say, onPending]);

  useEffect(() => { load(); }, [load, refresh]);

  if (!d) return <div className="loading">불러오는 중…</div>;

  const key = { factoryId: d.factoryId, date: d.date, shift: d.shift };
  const sel = (patch: Any) => setQ({ factory: d.factoryId, date: d.date, shift: d.shift, ...patch });
  const serverNow = () => Date.parse(d.nowIso) + (Date.now() - fetchedAt.current);
  const minsLeft = (expiresAt: string) => Math.max(0, Math.ceil((Date.parse(expiresAt) - serverNow()) / 60000));

  const rows = d.rows.filter((r: Any) => !r.unmanned);
  const { need, present, diff } = d.summary;
  const absences = d.absences
    .filter((a: Any) => a.status !== 'not-needed')
    .sort((a: Any, b: Any) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9) || (a.createdAt < b.createdAt ? 1 : -1));
  const open = absences.filter((a: Any) => a.status !== 'resolved').length;

  // 오늘 출근한 사람(자리에 있는 사람 + 대기)
  const everyone = [
    ...d.rows.flatMap((r: Any) => r.assigned.map((a: Any) => ({ id: a.personId, name: a.name, role: a.role, at: r.code }))),
    ...d.standby.map((p: Any) => ({ id: p.personId, name: p.name, role: p.role, at: '' })),
  ];

  const setPlan = (row: Any, value: string) => act({
    type: 'setPlan', date: d.date, shift: d.shift, postId: row.postId,
    productId: value === 'off' ? row.productId : value || null,
    status: value === 'off' ? 'off' : 'run',
  });

  return (
    <div style={{ maxWidth: 1100 }}>
      <div className="toolbar">
        <div className="seg">
          {d.factories.map((f: Any) => (
            <button key={f.id} className={d.factoryId === f.id ? 'on' : ''} onClick={() => sel({ factory: f.id })}>{f.name}</button>
          ))}
        </div>
        <div className="seg">
          <button className={d.shift === 'day' ? 'on' : ''} onClick={() => sel({ shift: 'day' })}>주간</button>
          <button className={d.shift === 'night' ? 'on' : ''} onClick={() => sel({ shift: 'night' })}>야간</button>
        </div>
        <button className="btn btn-sm" onClick={() => sel({ date: addDays(d.date, -1) })}>이전 날</button>
        <input type="date" value={d.date} onChange={(e) => e.target.value && sel({ date: e.target.value })} aria-label="날짜"
          style={{ padding: '5px 8px', borderRadius: 8, border: '1px solid var(--border)' }} />
        <button className="btn btn-sm" onClick={() => sel({ date: addDays(d.date, 1) })}>다음 날</button>
      </div>

      <div className="card big-summary" style={{ marginBottom: 14 }}>
        <div><div className="label">필요</div><div className="n">{need}명</div></div>
        <div><div className="label">출근</div><div className="n">{present}명</div></div>
        <div>
          <div className="label">결과</div>
          <div className="n" style={{ color: diff < 0 ? 'var(--danger)' : 'var(--ok)' }}>
            {diff < 0 ? `${-diff}명 부족` : diff > 0 ? `${diff}명 여유` : '딱 맞음'}
          </div>
        </div>
        <div className="summary-actions">
          <button className="btn btn-primary" style={{ minHeight: 48, fontSize: 17 }} onClick={() => act({ type: 'autoAssign', ...key })}>자동 배치</button>
          <button className="btn btn-ok" style={{ minHeight: 48, fontSize: 17 }} disabled={!d.hasAssignments} onClick={() => act({ type: 'confirm', ...key })}>
            {d.status === 'confirmed' ? '확정됨' : '확정'}
          </button>
        </div>
      </div>

      <table className="grid board">
        <thead>
          <tr>
            <th style={{ width: 150 }}>라인</th>
            <th style={{ width: 200 }}>생산계획 (제품)</th>
            <th style={{ width: 60 }}>필요</th>
            <th>배치</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r: Any) => {
            const off = r.status === 'off';
            return (
              <tr key={r.postId} style={{ background: off ? 'var(--off-bg)' : undefined }}>
                <td className="c-line"><strong>{r.code}</strong> <span className="muted">{r.name}</span></td>
                <td className="c-plan">
                  {r.kind === 'line' ? (
                    <select value={off ? 'off' : r.productId ?? ''} onChange={(e) => setPlan(r, e.target.value)} aria-label={`${r.code} 생산계획`}
                      style={{ width: '100%', padding: 4, borderRadius: 6, border: '1px solid var(--border)', background: 'transparent' }}>
                      <option value="">제품 미정</option>
                      {d.products.map((p: Any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      <option value="off">— 쉼 —</option>
                    </select>
                  ) : <span className="muted">{r.role}</span>}
                </td>
                <td className="c-need">{r.need}<span className="c-need-unit">명 필요</span></td>
                <td className="c-people">
                  {r.assigned.map((a: Any) => (
                    <button key={a.id} className={`slot ${a.source === 'sub' || a.source === 'move' ? 'sub' : a.locked ? 'locked' : ''}`}
                      title={[a.reason, ...a.flags.map((f: string) => FLAG_LABEL[f] ?? f)].filter(Boolean).join(' · ')}
                      onClick={() => setPick({ a, row: r })}>{a.name}</button>
                  ))}
                  {Array.from({ length: r.vacancies }, (_, i) => (
                    <button key={i} className="slot empty" style={{ cursor: 'pointer' }} onClick={() => setPick({ row: r })}>빈자리 +</button>
                  ))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="muted" style={{ fontSize: 13 }}>
        대기 {d.standby.length}명{d.standby.length ? `: ${d.standby.map((p: Any) => p.name).join(', ')}` : ''} · 이름을 누르면 결근·병가·조퇴·지각을 등록하고 대체 인력을 추천받을 수 있어요. 빈자리를 누르면 넣을 사람을 추천합니다.
      </p>

      {absences.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h2 style={{ fontSize: 17, marginBottom: 8 }}>
            결근 · 예외 상황 {open > 0 && <span className="badge badge-danger">대체 필요 {open}</span>}
          </h2>
          {absences.map((a: Any) => <AbsenceCard key={a.id} a={a} act={act} minsLeft={minsLeft} />)}
        </div>
      )}

      {pick && <PickDialog d={d} pick={pick} everyone={everyone} act={act} say={say} minsLeft={minsLeft} onClose={() => setPick(null)} />}
    </div>
  );
}

/** 대체 인력 추천 목록: 후보 3명만 보여 주고 나머지는 「후보 N명 더 보기」. 요청을 보낸 사람은 항상 보인다. */
function Recs({ recs, requests, minsLeft, onAssign, onRequest }: {
  recs: Any[]; requests: Any[]; minsLeft: (e: string) => number; onAssign: (id: string) => void; onRequest?: (ids: string[]) => void;
}) {
  const [all, setAll] = useState(false);
  if (!recs.length) return <div className="muted rec-empty">추천할 사람이 없습니다.</div>;
  const reqOf = (id: string) => {
    const list = requests.filter((r) => r.personId === id);
    return list.find((r) => r.status === 'sent') ?? list[list.length - 1];
  };
  const group = recs.filter((c) => c.type !== 'standby' && reqOf(c.personId)?.status !== 'sent').slice(0, 3);
  const shown = all ? recs : recs.filter((c, i) => i < 3 || reqOf(c.personId));
  const more = recs.length - shown.length;

  return (
    <div className="recs">
      {shown.map((c) => {
        const i = recs.indexOf(c);
        const req = reqOf(c.personId);
        const other = c.reasons.find((x: string) => !WHY[x]);
        const kind = c.type === 'standby' ? 'standby' : other ? 'other' : 'off';
        const why = c.reasons.map((x: string) => WHY[x] ?? x);
        const warn = c.cautions[0] ? FLAG_LABEL[c.cautions[0]] ?? c.cautions[0] : '';
        return (
          <div key={c.personId} className={`rec ${i === 0 ? 'top' : ''}`}>
            <span className="rec-rank">{i + 1}</span>
            <div className="rec-main">
              <div className="rec-name">
                <strong>{c.name}</strong>
                <span className={`badge rec-kind ${kind}`}>{KIND_TEXT[kind]}</span>
                {req && (
                  <span className={`badge ${req.status === 'declined' || req.status === 'expired' ? 'badge-danger' : 'badge-wait'}`}>
                    {REQ_TEXT[req.status]}{req.status === 'sent' && ` ${minsLeft(req.expiresAt)}분`}
                  </span>
                )}
              </div>
              {(why.length > 0 || warn) && (
                <div className="rec-why">
                  {why.join(' · ')}
                  {warn && <span className="rec-warn">{why.length > 0 && ' · '}⚠ {warn}</span>}
                </div>
              )}
            </div>
            <div className="rec-act">
              {c.type === 'standby' ? (
                <button className="btn btn-primary btn-sm" onClick={() => onAssign(c.personId)}>바로 배치</button>
              ) : (
                <>
                  {onRequest && req?.status !== 'sent' && <button className="btn btn-sm" onClick={() => onRequest([c.personId])}>요청</button>}
                  <button className="btn btn-sm" title="전화 등으로 본인 확인을 했을 때"
                    onClick={() => confirm(`${c.name} 님을 이 자리에 넣을까요? (본인 확인 후)`) && onAssign(c.personId)}>배치</button>
                </>
              )}
            </div>
          </div>
        );
      })}
      {more > 0 && <button className="btn btn-sm rec-more" onClick={() => setAll(true)}>후보 {more}명 더 보기</button>}
      {onRequest && group.length > 1 && (
        <button className="btn btn-primary rec-all" onClick={() => onRequest(group.map((c) => c.personId))}>{group.length}명에게 동시에 요청</button>
      )}
    </div>
  );
}

function AbsenceCard({ a, act, minsLeft }: { a: Any; act: TabProps['act']; minsLeft: (e: string) => number }) {
  const head = (
    <div className="abs-head">
      <strong>{a.postCode ? `${a.postCode} ${a.postName}` : '자리 없음'}</strong>
      <span>{a.name} · {KIND_LABEL[a.kind as 'absent']}</span>
      <span className="muted">{REPORTER_LABEL[a.reportedBy]} 신고 {hhmm(a.createdAt)}</span>
      {a.status !== 'resolved' && (
        <button className="btn btn-sm" style={{ marginLeft: 'auto' }}
          onClick={() => confirm(`${a.name} 님의 신고를 취소하고 원래 자리로 되돌릴까요?`) && void act({ type: 'cancelAbsence', absenceId: a.id })}>신고 취소</button>
      )}
    </div>
  );
  if (a.status === 'resolved') {
    return (
      <div className="card abs-card resolved">
        {head}
        <div style={{ color: 'var(--ok)', fontWeight: 700, marginTop: 4 }}>{a.resolvedName} 투입 완료 · {Math.max(1, a.minutes ?? 0)}분 만에 해결</div>
      </div>
    );
  }
  if (a.status === 'pre-board') {
    return (
      <div className="card abs-card in-progress">
        {head}
        <div className="abs-state" style={{ marginBottom: 0 }}>배치 전 — 자동 배치 때 반영됩니다.</div>
      </div>
    );
  }
  return (
    <div className={`card abs-card ${a.status}`}>
      {head}
      <div className="abs-state">{a.status === 'in-progress' ? '대체 요청을 보냈습니다. 먼저 수락한 사람이 들어갑니다.' : '대체 인력 추천'}</div>
      <Recs recs={a.candidates} requests={a.requests} minsLeft={minsLeft}
        onAssign={(id) => void act({ type: 'placeAbsence', absenceId: a.id, personId: id })}
        onRequest={(ids) => void act({ type: 'request', absenceId: a.id, personIds: ids })} />
    </div>
  );
}

/** 이름 칸 또는 빈자리를 눌렀을 때 뜨는 창 */
function PickDialog({ d, pick, everyone, act, say, minsLeft, onClose }: {
  d: Any; pick: Any; everyone: Any[]; act: TabProps['act']; say: TabProps['say']; minsLeft: (e: string) => number; onClose: () => void;
}) {
  const [value, setValue] = useState('');
  const [recs, setRecs] = useState<Any[] | null>(null);
  const a = pick.a ?? null;
  const row = pick.row;
  const key = { factoryId: d.factoryId, date: d.date, shift: d.shift };

  useEffect(() => {
    if (a) return;
    get(`/api/admin/slot?${qs({ factory: d.factoryId, date: d.date, shift: d.shift, post: row.postId })}`)
      .then((r) => setRecs(r.candidates))
      .catch((e) => { setRecs([]); say(e.message, true); });
  }, [a, d.factoryId, d.date, d.shift, row.postId, say]);

  const others = everyone.filter((p) => p.id !== a?.personId);
  const place = async (personId: string) => {
    await act({ type: 'placeManual', ...key, postId: row.postId, personId });
    onClose();
  };

  return (
    <div className="popover" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginBottom: 12 }}>
          {row.code} {a ? `· ${a.name}` : '· 빈자리'}{' '}
          <span className="muted" style={{ fontSize: 13, fontWeight: 500 }}>{md(d.date)} {d.shift === 'day' ? '주간' : '야간'}</span>
        </h3>
        {a ? (
          <>
            <div className="dlg-label">예외 상황 등록 → 대체 인력 추천</div>
            <div className="exc-grid">
              {EXCEPTIONS.map(([kind, label]) => (
                <button key={kind} className="btn btn-danger" onClick={async () => {
                  await act({ type: 'absence', personId: a.personId, date: d.date, shift: d.shift, kind });
                  onClose();
                }}>{label}</button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="dlg-label">이 자리에 넣을 사람 추천</div>
            {recs === null ? <div className="muted rec-empty">불러오는 중…</div> : <Recs recs={recs} requests={[]} minsLeft={minsLeft} onAssign={place} />}
          </>
        )}
        <div className="dlg-label" style={{ marginTop: 14 }}>{a ? '다른 사람으로 바꾸기' : '오늘 출근한 사람 중에서 직접 고르기'}</div>
        <select value={value} onChange={(e) => setValue(e.target.value)} style={{ width: '100%', padding: 8, borderRadius: 8 }} aria-label="사람 고르기">
          <option value="">선택…</option>
          {others.map((p) => (
            <option key={p.id} value={p.id}>{p.name} · {p.role}{p.at ? ` (지금 ${p.at} — 맞바꿈)` : ' (대기)'}</option>
          ))}
        </select>
        <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>닫기</button>
          <button className="btn btn-primary" disabled={!value} onClick={async () => {
            if (a) { await act({ type: 'replace', assignmentId: a.id, personId: value }); onClose(); } else await place(value);
          }}>적용</button>
        </div>
      </div>
    </div>
  );
}
