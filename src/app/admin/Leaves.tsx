'use client';
// 휴무 승인: 신청 목록 → 승인/반려. 승인하면 그날 근무에서 빠지고 결근 처리(대체 추천)로 이어진다.
import { useEffect, useState } from 'react';
import { get, type Any } from '../client';
import type { TabProps } from './page';
import { CREW_LABEL, WEEKDAY, md } from '@/lib/labels';
import { dow } from '@/lib/dates';

export default function Leaves({ act, refresh, say }: TabProps) {
  const [d, setD] = useState<Any>(null);
  useEffect(() => {
    get('/api/admin/leaves').then(setD).catch((e) => say(e.message, true));
  }, [refresh, say]);
  if (!d) return <div className="loading">불러오는 중</div>;
  const waiting = d.leaves.filter((l: Any) => l.status === 'pending').length;
  return (
    <div style={{ maxWidth: 860 }}>
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>휴무 승인</h1>
      <p className="muted" style={{ margin: '0 0 14px' }}>
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
