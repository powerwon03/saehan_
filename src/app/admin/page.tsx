'use client';
// 관리자 화면(PC). 메뉴: 배치 · 생산계획 · 휴무 승인 · 근로자 관리 · 엑셀 가져오기 (+ 기준 정보 · 설정)
import { useCallback, useEffect, useRef, useState } from 'react';
import { get, post, type Any } from '../client';
import Board from './Board';
import Plan from './Plan';
import Leaves from './Leaves';
import People from './People';
import Excel from './Excel';
import Master from './Master';
import SettingsTab from './SettingsTab';

export interface TabProps {
  /** 동작을 서버에 보내고 화면을 다시 받는다. 실패하면 null */
  act: (body: Any, okMessage?: string) => Promise<Any | null>;
  /** 값이 바뀌면 데이터를 다시 받는다 */
  refresh: number;
  me: Any;
  say: (text: string, bad?: boolean) => void;
  go: (tab: string) => void;
}

const TABS: [string, string][] = [
  ['board', '배치'], ['plan', '생산계획'], ['leaves', '휴무 승인'], ['people', '근로자 관리'], ['import', '엑셀 가져오기'], ['master', '기준 정보'], ['settings', '설정'],
];
const SAVE_LABEL: Record<string, string> = { loading: '불러오는 중', saved: '저장됨', saving: '저장 중', error: '저장 재시도 중' };

export default function Admin() {
  const [me, setMe] = useState<Any>(null);
  const [tab, setTab] = useState('board');
  const [refresh, setRefresh] = useState(0);
  const [saving, setSaving] = useState<'loading' | 'saving' | 'saved' | 'error'>('loading');
  const [toast, setToast] = useState<{ text: string; bad: boolean } | null>(null);
  const [pending, setPending] = useState(0);
  const rev = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const say = useCallback((text: string, bad = false) => {
    setToast({ text, bad });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), bad ? 6000 : 3000);
  }, []);

  useEffect(() => {
    get('/api/me').then((m) => {
      if (m.session?.role !== 'admin') window.location.replace('/');
      else { setMe(m); setSaving('saved'); }
    }).catch((e) => say(e.message, true));
  }, [say]);

  // 4초마다 버전 번호만 확인해 바뀌면 다시 받는다(근무자의 신고·응답이 바로 보인다).
  useEffect(() => {
    if (!me) return;
    const tick = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const r = await get('/api/rev');
        if (rev.current !== null && rev.current !== r.rev) setRefresh((x) => x + 1);
        rev.current = r.rev;
      } catch { /* 다음에 다시 */ }
    };
    tick();
    const t = setInterval(tick, 4000);
    return () => clearInterval(t);
  }, [me]);

  const act = useCallback(async (body: Any, okMessage?: string) => {
    setSaving('saving');
    try {
      const r = await post('/api/admin/action', body);
      setSaving('saved');
      setRefresh((x) => x + 1);
      if (okMessage) say(okMessage);
      return r ?? {};
    } catch (e) {
      setSaving('error');
      say((e as Error).message, true);
      return null;
    }
  }, [say]);

  if (!me) return <div className="loading">확인 중</div>;
  const s = me.session;
  const props: TabProps = { act, refresh, me, say, go: setTab };

  return (
    <>
      <header className="admin-top">
        <span className="brand">새한 프라텍</span>
        <nav>
          {TABS.map(([k, label]) => (
            <a key={k} href={`#${k}`} className={tab === k ? 'active' : ''} onClick={(e) => { e.preventDefault(); setTab(k); }}>
              {label}
              {k === 'leaves' && pending > 0 && <span className="nav-count">{pending}</span>}
            </a>
          ))}
        </nav>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className={`save save-${saving}`}>{SAVE_LABEL[saving]}</span>
          {s.demo && (
            <button className="btn btn-sm" onClick={() => confirm('이 회사 데이터를 데모 처음 상태로 되돌릴까요?') && void act({ type: 'demoReset' })}>데모 초기화</button>
          )}
          <button className="btn btn-sm" onClick={async () => { await post('/api/logout', {}).catch(() => null); window.location.replace('/'); }}>처음으로</button>
        </span>
      </header>
      {me.storage?.note && <div className="notice-bar">{me.storage.note}</div>}
      <main className="admin-main">
        {tab === 'board' && <Board {...props} onPending={setPending} />}
        {tab === 'plan' && <Plan {...props} />}
        {tab === 'leaves' && <Leaves {...props} />}
        {tab === 'people' && <People {...props} />}
        {tab === 'import' && <Excel {...props} />}
        {tab === 'master' && <Master {...props} />}
        {tab === 'settings' && <SettingsTab {...props} />}
      </main>
      {toast && <div className={`toast${toast.bad ? ' bad' : ''}`} role="status">{toast.text}</div>}
    </>
  );
}
