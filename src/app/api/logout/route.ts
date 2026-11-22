import { api, endSession } from '@/server/session';

export async function POST() {
  return api(async () => {
    await endSession();
    return { ok: true };
  }, true);
}
