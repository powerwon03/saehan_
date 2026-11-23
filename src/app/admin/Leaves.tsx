'use client';
// 휴무 승인: 근무자가 누른 「오늘 못 나와요」 신고 알림 + 휴무 신청 목록(승인/반려).
// 승인하면 그날 근무에서 빠지고 결근 처리(대체 추천)로 이어진다.
import { useEffect, useState } from 'react';
import { get, qs, type Any } from '../client';
import type { TabProps } from './page';
import { CREW_LABEL, WEEKDAY, md } from '@/lib/labels';
import { dow } from '@/lib/dates';

const hhmm = (isoStr: string) => new Date(Date.parse(isoStr) + 9 * 3600000).toISOString().slice(11, 16);
const REPORT_TEXT: Record<string, string> = {
  decided: '대체 필요', failed: '대체 필요', 'in-progress': '요청 보냄 · 응답 대기', 'pre-board': '배치 전 · 자동 배치 때 반영',
  'not-needed': '대체 불필요', resolved: '해결',
};

export default function Leaves({ act, refresh, say, go }: TabProps) {
  const [d, setD] = useState<Any>(null);
  useEffect(() => {
    get('/api/admin/leaves').then(setD).catch((e) => say(e.message, true));
  }, [refresh, say]);
  if (!d) return <div className="loading">불러오는 중</div>;
  const waiting = d.leaves.filter((l: Any) => l.status === 'pending').length;
  const reports: Any[] = d.reports ?? [];
  const open = reports.filter((r) => r.open).length;

  /** 그 신고가 난 공장·날짜·교대의 배치 화면을 연다 */
  const openBoard = (r: Any) => {
    window.history.replaceState(null, '', `/admin?${qs({ factory: r.factoryId, date: r.date, shift: r.shift })}`);
    go('board');
  };

  return (
    <div style={{ maxWidth: 860 }}>
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>휴무 승인</h1>
      <p className="muted" style={{ margin: '0 0 14px' }}>
        근무자가 누른 「오늘 못 나와요」 신고와 휴무 신청이 여기에 모입니다.
      </p>

      <h2 style={{ fontSize: 17, marginBottom: 8 }}>
        「오늘 못 나와요」 신고 {open > 0 && <span className="badge badge-danger">확인 필요 {open}</span>}
      </h2>
      {reports.length ? reports.map((r) => (
        <div key={r.id} className={`card abs-card ${r.open ? (r.status === 'in-progress' || r.status === 'pre-board' ? 'in-progress' : '') : 'resolved'}`}>
          <div className="abs-head" style={{ alignItems: 'center' }}>
            <strong>{r.name}</strong>
            <span>
              {r.factory} · {CREW_LABEL[r.crew as 'A'] ?? r.crew} · {md(r.date)} ({WEEKDAY[dow(r.date)]}) {r.shift === 'day' ? '주간' : '야간'}
              {r.postCode && ` · ${r.postCode} ${r.postName}`}
            </span>
            <span className="muted">{hhmm(r.createdAt)} 신고</span>
            <span className={`badge ${r.status === 'resolved' ? 'badge-ok' : r.open && r.status !== 'in-progress' && r.status !== 'pre-board' ? 'badge-danger' : 'badge-wait'}`}>
              {r.status === 'resolved' ? `${r.resolvedName} 투입 완료` : REPORT_TEXT[r.status] ?? r.status}
            </span>
            {r.open && (
              <button className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }} onClick={() => openBoard(r)}>
                {r.status === 'pre-board' ? '배치 화면 열기' : '대체 인력 찾기'}
              </button>
            )}
          </div>
        </div>
      )) : <div className="card muted" style={{ padding: 20 }}>들어온 신고가 없습니다.</div>}

      <h2 style={{ fontSize: 17, margin: '22px 0 4px' }}>휴무 신청</h2>
      <p className="muted" style={{ margin: '0 0 10px', fontSize: 13 }}>
        승인 대기 {waiting}건 · 승인하면 그날 배치에서 빠지고, 대신 일할 사람을 추천합니다.
      </p>
      {d.leaves.length ? (
        <div className="table-scroll">
          <table className="grid">
            <thead>
              <tr><th>날짜</th><th>이름</th><th>공장 · 조</th><th>그날 근무</th><th>상태</th><th style={{ width: 160 }} /></tr>
            </thead>
            <tbody>
              {d.leaves.map((l: Any) => (
                <tr key={l.id}>
                  <td><strong>{md(l.date)} ({WEEKDAY[dow(l.date)]})</strong></td>
                  <td>{l.name}</td>
                  <td>{l.factory} · {CREW_LABEL[l.crew as 'A'] ?? l.crew}</td>
                  <td>{l.shift === 'day' ? '주간' : l.shift === 'night' ? '야간' : '원래 휴무'}</td>
                  <td>
                    <span className={`badge ${l.status === 'approved' ? 'badge-ok' : l.status === 'rejected' ? 'badge-danger' : 'badge-wait'}`}>
                      {l.status === 'approved' ? '승인' : l.status === 'rejected' ? '반려' : '승인 대기'}
                    </span>
                  </td>
                  <td>
                    {l.status === 'pending' && (
                      <span style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-primary btn-sm" onClick={() => act({ type: 'leaveDecide', id: l.id, approve: true })}>승인</button>
                        <button className="btn btn-sm" onClick={() => act({ type: 'leaveDecide', id: l.id, approve: false })}>반려</button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <div className="card muted" style={{ padding: 20 }}>들어온 휴무 신청이 없습니다.</div>}
    </div>
  );
}
