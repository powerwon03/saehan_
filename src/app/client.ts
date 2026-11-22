'use client';
// 화면에서 서버 API를 부르는 얇은 도우미.

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Any = any;

async function call(url: string, init?: RequestInit) {
  let res: Response;
  try {
    res = await fetch(url, { ...init, cache: 'no-store', credentials: 'same-origin' });
  } catch {
    throw new Error('서버에 연결할 수 없습니다.');
  }
  let data: Any = null;
  try { data = await res.json(); } catch { /* 본문 없음 */ }
  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined' && window.location.pathname !== '/') {
      window.location.href = '/';
    }
    throw new Error(data?.error ?? `오류가 났습니다(${res.status}).`);
  }
  return data;
}

export const get = (url: string): Promise<Any> => call(url);
export const post = (url: string, body: unknown): Promise<Any> =>
  call(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });

export const qs = (o: Record<string, string | undefined>) =>
  Object.entries(o).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join('&');
