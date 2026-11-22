// 체험 데이터(가상 근무자·기준 생산계획)를 화면 없이 찍어 본다. 실행: npx tsx scripts/seed-preview.ts [날짜]
import { seedDemo } from '../src/lib/seed';

const s = seedDemo(process.argv[2] ?? '2026-11-22');
const product = (id: string | null) => s.products.find((p) => p.id === id)?.name ?? '제품 미정';
for (const shift of ['day', 'night'] as const) {
  console.log(`기준 계획 ${shift === 'day' ? '주간' : '야간'}:`, s.plan.filter((c) => c.shift === shift)
    .map((c) => `${s.posts.find((p) => p.id === c.postId)!.code}=${c.status === 'off' ? '쉼' : c.status === 'unmanned' ? '무인' : product(c.productId)}`).join(', '));
}
for (const f of s.factories) {
  for (const crew of ['A', 'B', 'C']) {
    const list = s.people.filter((p) => p.factoryId === f.id && p.crew === crew);
    console.log(`${f.name} ${crew}조 ${list.length}명:`, list.map((p) => p.name).join(', '));
  }
}
console.log(`모두 ${s.people.length}명`);
