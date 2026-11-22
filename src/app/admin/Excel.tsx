'use client';
// 엑셀 가져오기: 직원 명단·생산계획 올리기, 양식 받기, 월 근태표 내보내기.
// 양식을 모르는 파일은 미리보기만 한다. 파일은 브라우저에서 읽고 행만 서버로 보낸다.
import { useState } from 'react';
import { get, type Any } from '../client';
import type { TabProps } from './page';
import { CREW_SHORT } from '@/lib/labels';

const PEOPLE_COLS = ['사번', '이름', '소속', '조', '역할', '성별', '전화', '공장', '언어', '입사일', '퇴사일', '지정자리'];
const PLAN_COLS = ['날짜', '교대', '공장', '라인', '제품', '상태'];

interface Sheet { name: string; preview: string[][]; rows: Record<string, string>[] }

function cell(v: unknown): string {
  // 날짜 칸은 YYYY-MM-DD 로. 시간대가 어긋나도 날짜가 밀리지 않게 12시간을 더해 자른다.
  if (v instanceof Date) return new Date(v.getTime() + 12 * 3600000).toISOString().slice(0, 10);
  return v === null || v === undefined ? '' : String(v).trim();
}

export default function Excel({ act, say }: TabProps) {
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [result, setResult] = useState<Any>(null);
  const month = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 7);

  async function onFile(f: File | undefined) {
    if (!f) return;
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: true });
      const list: Sheet[] = wb.SheetNames.map((name) => {
        const ws = wb.Sheets[name];
        const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' });
        const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
        return {
          name,
          preview: aoa.slice(0, 8).map((r) => r.slice(0, 20).map(cell)),
          rows: json.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [String(k).trim(), cell(v)]))),
        };
      });
      setSheets(list);
      setFileName(f.name);
      setSheetName(list[0]?.name ?? '');
      setResult(null);
    } catch {
      say('엑셀 파일을 읽을 수 없습니다.', true);
    }
  }

  async function template(kind: 'people' | 'plans') {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    if (kind === 'people') {
      const m = await get('/api/admin/master');
      const codes = [...new Set<string>(m.posts.filter((p: Any) => !p.unmanned && p.active).map((p: Any) => p.code))];
      const rows = [
        [...PEOPLE_COLS, ...codes],
        ['240901', '홍길순', '협력사', 'A', '검사원', '여', '010-1234-5678', m.factories[0]?.name ?? '1공장', '한국어', m.today, '', '', ...codes.map((_, i) => (i === 0 ? '숙련' : i === 1 ? '초급' : ''))],
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), '명단');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        ['열', '적는 법'],
        ['사번', '같은 사번이 있으면 고치고, 없으면 새로 등록합니다'],
        ['조', 'A / B / C / 주간'],
        ['퇴사일', '날짜를 적으면 그날부터 퇴사 처리합니다 (기록은 남습니다)'],
        ['라인·직책 코드 (L-1, OP …)', '숙련도: 0~3 또는 없음 · 초급 · 중급 · 숙련. 빈칸은 바꾸지 않습니다'],
      ]), '안내');
      XLSX.writeFile(wb, '직원명단_양식.xlsx');
    } else {
      const m = await get('/api/admin/master');
      const f = m.factories[0];
      const line = m.posts.find((p: Any) => p.factoryId === f?.id && p.kind === 'line');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        PLAN_COLS,
        [m.today, '주간', f?.name ?? '1공장', line?.code ?? 'L-1', m.products[0]?.name ?? '', '가동'],
      ]), '생산계획');
      XLSX.writeFile(wb, '생산계획_양식.xlsx');
    }
  }

  async function exportMonth() {
    try {
      const XLSX = await import('xlsx');
      const r = await get(`/api/admin/attendance?month=${month}`);
      const wb = XLSX.utils.book_new();
      const factories = [...new Set<string>(r.rows.map((x: Any) => x.factory))];
      for (const f of factories.length ? factories : ['근태표']) {
        const head = ['사번', '이름', '조', ...r.days.map((d: string) => +d.slice(8)), '근무일', '야간', '대체', '빠진 날', '인정 시간'];
        const body = r.rows.filter((x: Any) => !factories.length || x.factory === f)
          .map((x: Any) => [x.empNo, x.name, CREW_SHORT[x.crew as 'A'] ?? x.crew, ...x.cells, x.work, x.night, x.sub, x.missed, x.hours]);
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head, ...body]), f);
      }
      XLSX.writeFile(wb, `근태표_${month}.xlsx`);
    } catch (e) {
      say((e as Error).message, true);
    }
  }

  const sheet = sheets?.find((s) => s.name === sheetName);
  const head = sheet?.preview[0] ?? [];
  const kind = PEOPLE_COLS.slice(0, 3).every((c) => head.includes(c)) ? 'people' : PLAN_COLS.slice(0, 4).every((c) => head.includes(c)) ? 'plans' : null;

  return (
    <div style={{ maxWidth: 1000 }}>
      <h1 style={{ fontSize: 22, marginBottom: 6 }}>엑셀 가져오기</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        양식에 맞춘 직원 명단이나 생산계획을 올리면 바로 반영됩니다. 2025년 배치표·근태표 원본 양식은 파일을 받은 뒤 전용 변환을 추가합니다. 지금은 원본을 올리면 시트 내용을 미리보기로 확인할 수 있습니다.
      </p>
      <div className="toolbar">
        <button className="btn" onClick={() => template('people')}>직원 명단 양식 받기</button>
        <button className="btn" onClick={() => template('plans')}>생산계획 양식 받기</button>
        <button className="btn" onClick={exportMonth}>{month} 근태표 내보내기</button>
      </div>
      <label className="card" style={{ display: 'block', padding: 24, textAlign: 'center', borderStyle: 'dashed', cursor: 'pointer' }}>
        <input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
        <strong>엑셀 파일 고르기</strong>
        <div className="muted" style={{ fontSize: 13 }}>.xlsx · .xls · .csv</div>
        {fileName && <div style={{ marginTop: 6 }}>{fileName}</div>}
      </label>

      {sheets && sheet && (
        <div style={{ marginTop: 16 }}>
          <div className="toolbar">
            <span>시트:</span>
            <select value={sheetName} onChange={(e) => { setSheetName(e.target.value); setResult(null); }}>
              {sheets.map((s) => <option key={s.name}>{s.name}</option>)}
            </select>
            {kind
              ? <span className="badge badge-ok">{kind === 'people' ? '직원 명단 양식' : '생산계획 양식'}으로 인식</span>
              : <span className="badge badge-warn">양식을 인식하지 못함 — 미리보기만</span>}
            {kind && (
              <button className="btn btn-primary" onClick={async () => {
                const r = await act({ type: kind === 'people' ? 'importPeople' : 'importPlan', rows: sheet.rows });
                if (r) setResult(r);
              }}>가져오기</button>
            )}
          </div>
          {result && (
            <div className="card" style={{ padding: 12, marginBottom: 12 }}>
              새로 {result.created ?? result.saved ?? 0}건 · 고침 {result.updated ?? 0}건
              {result.errors?.length > 0 && (
                <ul style={{ color: 'var(--danger)', margin: '6px 0 0' }}>
                  {result.errors.slice(0, 20).map((e: string, i: number) => <li key={i}>{e}</li>)}
                </ul>
              )}
            </div>
          )}
          <div style={{ overflowX: 'auto' }}>
            <table className="grid" style={{ fontSize: 12 }}>
              <tbody>
                {sheet.preview.map((r, i) => (
                  <tr key={i}>{r.map((c, j) => (i === 0 ? <th key={j}>{c}</th> : <td key={j}>{c}</td>))}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
