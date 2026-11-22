// 엑셀 파일의 시트 이름과 앞부분 내용을 찍어 본다(가져오기 변환을 만들 때 쓰는 도구).
//   npx tsx scripts/inspect-xlsx.ts <파일> [시트 번호 또는 이름] [줄 수] [칸 수]
import * as XLSX from 'xlsx';
import fs from 'node:fs';

const [file, which, rowsArg, colsArg] = process.argv.slice(2);
const wb = XLSX.read(fs.readFileSync(file), { cellDates: true });
console.log('시트:', wb.SheetNames.map((n, i) => `${i}:${n}`).join(' | '));
const name = which === undefined ? wb.SheetNames[0] : /^\d+$/.test(which) ? wb.SheetNames[+which] : which;
const ws = wb.Sheets[name];
if (!ws) { console.log('시트 없음:', which); process.exit(0); }
console.log(`[${name}] 범위 ${ws['!ref']} · 병합 ${ws['!merges']?.length ?? 0}곳`);
const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: false });
const nRows = +(rowsArg ?? 40), nCols = +(colsArg ?? 30);
rows.slice(0, nRows).forEach((r, i) => {
  const cells = r.slice(0, nCols).map((c) => String(c ?? '').replace(/\s+/g, ' ').trim());
  while (cells.length && cells[cells.length - 1] === '') cells.pop();
  if (cells.length) console.log(String(i + 1).padStart(3), cells.map((c) => c || '·').join(' | '));
});
