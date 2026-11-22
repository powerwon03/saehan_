// 회사 등록 / 관리자 비밀번호 다시 정하기
//   npm run company -- <회사코드> <회사이름> --admin-password=<비밀번호>
//   npm run company -- saehan --admin-password=<새 비밀번호>      (이미 있는 회사는 비밀번호만 바꾼다)
import fs from 'node:fs';

for (const f of ['.env.local', '.env']) if (fs.existsSync(f)) process.loadEnvFile(f);

async function main() {
  const args = process.argv.slice(2);
  const pw = args.find((a) => a.startsWith('--admin-password='))?.split('=').slice(1).join('=');
  const [code, name] = args.filter((a) => !a.startsWith('--'));
  if (!code || !pw || !/^[a-z0-9-]{2,30}$/.test(code)) {
    console.error('사용법: npm run company -- <회사코드(영문 소문자·숫자)> <회사이름> --admin-password=<비밀번호>');
    process.exit(1);
  }
  if (pw.length < 8) {
    console.error('비밀번호는 8자 이상이어야 합니다.');
    process.exit(1);
  }
  const { createCompany, getCompany } = await import('../src/server/store');
  const { setPassword } = await import('../src/server/accounts');
  const cur = await getCompany(code);
  if (cur) {
    await setPassword(code, 'admin', 'admin', pw);
    console.log(`회사 「${cur.name}」(${code})의 관리자(admin) 비밀번호를 바꿨습니다.`);
  } else {
    await createCompany(code, name || code, pw);
    console.log(`회사 「${name || code}」(${code})를 등록했습니다. 주소: /?company=${code} · 관리자 아이디: admin`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
