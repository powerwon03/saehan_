'use client';
// 아웃소싱: 일용직 인원을 요청하는 업체 목록과, 달마다 업체별로 몇 명을 요청(투입)했는지.
// 요청 자체는 배치 화면의 빈자리에서 한다. 여기서는 업체를 관리하고 현황을 본다.
import { useEffect, useState } from 'react';
import { get, type Any } from '../client';
import type { TabProps } from './page';
import { OUT_JOB, WEEKDAY, md } from '@/lib/labels';
import { addMonths, dow } from '@/lib/dates';

export default function Outsource({ act, refresh, say, go }: TabProps) {
  const [month, setMonth] = useState('');
  const [d, setD] = useState<Any>(null);
  const [agency, setAgency] = useState<Any>(null);

  useEffect(() => {
    get(`/api/admin/outsource${month ? `?month=${month}` : ''}`).then(setD).catch((e) => say(e.message, true));
  }, [month, refresh, say]);
  if (!d) return <div className="loading">불러오는 중</div>;

  /** 그 날짜·교대·공장의 배치 화면을 연다 */
  const openBoard = (r: Any) => {
    window.history.replaceState(null, '', `/admin?factory=${r.factoryId}&date=${r.date}&shift=${r.shift}`);
    go('board');
  };

  return (
    <div style={{ maxWidth: 900 }}>
      <div className="toolbar">
        <h1 style={{ fontSize: 20 }}>아웃소싱</h1>
        <span className="muted">쉬는 사람으로 못 채운 자리는 업체에 인원수만 요청합니다. 요청은 배치 화면의 빈자리에서 합니다.</span>
      </div>

      <div className="toolbar" style={{ marginBottom: 8 }}>
        <h2 style={{ fontSize: 17 }}>업체</h2>
        <button className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setAgency({ name: '', phone: '' })}>업체 추가</button>
      </div>
      <div className="table-scroll">
        <table className="grid">
          <thead><tr><th>업체 이름</th><th>전화 (문자 받을 번호)</th><th>{+d.month.slice(5)}월 요청 인원</th><th style={{ width: 130 }} /></tr></thead>
          <tbody>
            {d.agencies.map((ag: Any) => (
              <tr key={ag.id}>
                <td><strong>{ag.name}</strong></td>
                <td>{ag.phone || <span className="muted">없음</span>}</td>
                <td>{ag.total ? `${ag.total}명 (남 ${ag.male} · 여 ${ag.female})` : <span className="muted">-</span>}</td>
                <td>
                  <span style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-sm" onClick={() => setAgency(ag)}>수정</button>
                    <button className="btn btn-sm danger-text" onClick={() => confirm(`${ag.name} 업체를 지울까요?`) && void act({ type: 'agencyDelete', id: ag.id })}>지우기</button>
                  </span>
                </td>
              </tr>
            ))}
            {!d.agencies.length && <tr><td colSpan={4} className="muted" style={{ textAlign: 'center', padding: 20 }}>등록한 업체가 없습니다. 「업체 추가」로 등록하세요.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>배치표에는 「업체명-남」「업체명-여」로 적힙니다. 전화번호를 적어 두면 배치 화면에서 바로 문자를 보낼 수 있습니다.</p>

      <div className="toolbar" style={{ margin: '22px 0 8px' }}>
        <h2 style={{ fontSize: 17 }}>요청 현황</h2>
        <button className="btn btn-sm" onClick={() => setMonth(addMonths(d.month, -1))}>이전 달</button>
        <strong>{d.month.slice(0, 4)}년 {+d.month.slice(5)}월</strong>
        <button className="btn btn-sm" onClick={() => setMonth(addMonths(d.month, 1))}>다음 달</button>
        <span className="muted">합계 {d.total}명</span>
      </div>
      <div className="table-scroll">
        <table className="grid">
          <thead><tr><th>날짜</th><th>교대</th><th>공장</th><th>업체</th><th>{OUT_JOB.M}</th><th>{OUT_JOB.F}</th><th>합계</th><th style={{ width: 100 }} /></tr></thead>
          <tbody>
            {d.rows.map((r: Any, i: number) => (
              <tr key={i}>
                <td><strong>{md(r.date)} ({WEEKDAY[dow(r.date)]})</strong></td>
                <td>{r.shift === 'day' ? '주간' : '야간'}</td>
                <td>{r.factory}</td>
                <td>{r.agency}</td>
                <td>{r.male || '-'}</td>
                <td>{r.female || '-'}</td>
                <td><strong>{r.male + r.female}명</strong></td>
                <td><button className="btn btn-sm" onClick={() => openBoard(r)}>배치 보기</button></td>
              </tr>
            ))}
            {!d.rows.length && <tr><td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 24 }}>이 달에는 아웃소싱 요청이 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>

      {agency && (
        <div className="popover" onClick={() => setAgency(null)}>
          <div className="card" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginBottom: 12 }}>{agency.id ? `${agency.name} 수정` : '아웃소싱 업체 추가'}</h3>
            <div className="form-grid">
              <label>업체 이름<input value={agency.name} onChange={(e) => setAgency({ ...agency, name: e.target.value })} autoFocus={!agency.id} /></label>
              <label>전화<input value={agency.phone} onChange={(e) => setAgency({ ...agency, phone: e.target.value })} placeholder="010-0000-0000" /></label>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setAgency(null)}>닫기</button>
              <button className="btn btn-primary" onClick={async () => {
                if (await act({ type: 'agencySave', id: agency.id, name: agency.name, phone: agency.phone })) setAgency(null);
              }}>저장</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
