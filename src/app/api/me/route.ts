import { api, getSession } from '@/server/session';
import { APP_NAME, demoEnabled, getCompany, read, storageInfo } from '@/server/store';

/** 지금 로그인한 사람 */
export async function GET() {
  return api(async () => {
    const s = await getSession();
    const c = s ? await getCompany(s.c) : null;
    const none = { app: APP_NAME, session: null, demoEnabled: demoEnabled() };
    if (!s || !c) return none;
    const name = s.r === 'worker'
      ? await read(s.c, (st) => st.people.find((p) => p.id === s.id && p.active)?.name ?? null)
      : '관리자';
    if (!name) return none;
    return {
      app: APP_NAME,
      demoEnabled: demoEnabled(),
      session: { role: s.r, id: s.id, name, company: c.code, companyName: c.name, demo: c.demo },
      storage: s.r === 'admin' ? await storageInfo() : undefined,
    };
  });
}
