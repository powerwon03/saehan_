'use client';
// 근무자 화면(휴대폰): 오늘 근무, 오늘 못 나와요, 대체 요청 응답, 휴무 신청, 월별 근무 기록.
import { useCallback, useEffect, useRef, useState } from 'react';
import { get, post, type Any } from '../client';
import { LANG_NAMES, LANGS, tr, weekday, type DictKey } from '@/lib/i18n';
import type { Lang } from '@/lib/types';
import { dow } from '@/lib/dates';
import { md } from '@/lib/labels';

type View =
  | { k: 'home' }
  | { k: 'leave' }
  | { k: 'history' }
  | { k: 'password' }
  | { k: 'done'; msg: DictKey; sub?: DictKey; undo?: boolean };

const RESULT_MSG: Record<string, DictKey> = { accepted: 'confirmed', taken: 'taken', declined: 'declinedMsg', expired: 'taken' };

export default function Worker() {
  const [v, setV] = useState<Any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [view, setView] = useState<View>({ k: 'home' });
  const [pick, setPick] = useState<string | null>(null);
  const [demo, setDemo] = useState(true);
  const [, setTick] = useState(0);
  const rev = useRef<number | null>(null);
  const fetchedAt = useRef(0);

  const load = useCallback(async () => {
    try {
      const r = await get('/api/worker');
      fetchedAt.current = Date.now();
      setV(r);
    } catch { /* 로그인이 풀렸으면 첫 화면으로 간다 */ }
  }, []);

  useEffect(() => {
    load();
    get('/api/me').then((m) => setDemo(!!m.session?.demo)).catch(() => {});
    // 4초마다 버전만 확인 — 요청이 오면 화면이 바로 바뀐다.
    const poll = setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const r = await get('/api/rev');
        if (rev.current !== r.rev) { rev.current = r.rev; load(); }
      } catch { /* 다음에 다시 */ }
    }, 4000);
    const tick = setInterval(() => setTick((x) => x + 1), 10000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, [load]);

  if (!v) return <div className="w-wrap loading">확인 중</div>;

  const lang: Lang = v.me.lang;
  const t = (key: DictKey, vars?: Record<string, string | number>) => tr(lang, key, vars);
  const factory = (id: string, name: string) => (id === 'f1' ? t('factory1') : id === 'f2' ? t('factory2') : name);
  const fmt = (d: string) => `${md(d)} (${weekday(lang, dow(d))})`;
  const serverNow = () => Date.parse(v.now) + (Date.now() - fetchedAt.current);

  async function send(body: Any, done?: (result: string) => void) {
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      const r = await post('/api/worker', body);
      if (r.view) { fetchedAt.current = Date.now(); setV(r.view); }
      done?.(r.result);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const error = err ? <p className="w-note warn">{err}</p> : null;
  const top = (
    <div className="w-top">
      <button className="w-link" onClick={async () => { await post('/api/logout', {}).catch(() => null); window.location.replace('/'); }}>{t('logout')}</button>
      <select className="w-lang" value={lang} onChange={(e) => send({ type: 'lang', lang: e.target.value })} aria-label="언어">
        {LANGS.map((l) => <option key={l} value={l}>{LANG_NAMES[l]}</option>)}
      </select>
    </div>
  );
  const home = () => { setPick(null); setView({ k: 'home' }); };

  if (view.k === 'done') {
    return (
      <div className="w-wrap">
        {top}
        <div className="w-result">
          <div className="w-check" aria-hidden />
          <div className="msg">{t(view.msg)}</div>
          {view.sub && <div className="sub">{t(view.sub)}</div>}
        </div>
        {view.undo && (
          <button className="w-btn outline" disabled={busy} onClick={() => send({ type: 'undo' }, () => setView({ k: 'done', msg: 'undone' }))}>{t('undo')}</button>
        )}
        <button className="w-btn primary" onClick={home}>{t('home')}</button>
        {error}
      </div>
    );
  }

  if (view.k === 'leave') {
    return (
      <div className="w-wrap">
        {top}
        <h1 className="w-title">{t('leave')}</h1>
        <div className="w-label">{t('leavePick')}</div>
        <div className="w-days">
          {v.leaveDays.map((x: Any) => {
            const asked = x.status === 'pending' || x.status === 'approved';
            return (
              <button key={x.date} disabled={!x.shift || asked} className={pick === x.date ? 'sel' : ''} onClick={() => setPick(x.date)}>
                <span className="dn">{+x.date.slice(8)}</span>
                <span className="dw">{weekday(lang, dow(x.date))}</span>
                <span className="ds">{asked ? t('pending') : x.shift ? t(x.shift) : '-'}</span>
              </button>
            );
          })}
        </div>
        <button className="w-btn primary" disabled={!pick || busy}
          onClick={() => send({ type: 'leave', date: pick }, () => { setPick(null); setView({ k: 'done', msg: 'leaveSent', sub: 'leaveSentSub' }); })}>
          {pick ? `${fmt(pick)} ${t('leaveSend')}` : t('leavePick')}
        </button>
        <button className="w-btn outline" onClick={home}>{t('home')}</button>
        {error}
      </div>
    );
  }

  if (view.k === 'history') {
    return (
      <div className="w-wrap">
        {top}
        <h1 className="w-title">{t('history')}</h1>
        <div className="w-months">
          {v.months.map((m: Any, i: number) => (
            <div key={m.month} className={`w-month ${i === 0 ? 'now' : ''}`}>
              <div className="w-month-head">
                <span>{i === 0 ? t('histThisMonth') : t('histMonth', { y: m.month.slice(0, 4), m: +m.month.slice(5) })}</span>
                <strong>{t('histDays', { n: m.days })}</strong>
              </div>
              <div className="w-month-body">
                <span>{t('histShifts', { d: m.day, n: m.night })}</span>
                <span>{t('histHours', { n: m.hours })}</span>
                {m.subs > 0 && <span>{t('histSubs', { n: m.subs })}</span>}
                {m.missed > 0 && <span>{t('histOff', { n: m.missed })}</span>}
              </div>
            </div>
          ))}
        </div>
        <p className="w-note">{t('histNote')}</p>
        <button className="w-btn outline" onClick={home}>{t('home')}</button>
      </div>
    );
  }

  if (view.k === 'password') {
    return <PasswordView top={top} onDone={() => setView({ k: 'done', msg: 'undone' })} onHome={home} homeLabel={t('home')} />;
  }

  // 대체 요청이 오면 화면이 요청으로 바뀐다.
  const req = v.request;
  if (req) {
    const respond = (accept: boolean) => send({ type: 'respond', requestId: req.id, accept }, (r) => setView({ k: 'done', msg: RESULT_MSG[r] ?? 'taken' }));
    return (
      <div className="w-wrap">
        {top}
        <h1 className="w-title">{t('reqTitle')}</h1>
        <div className={`w-card ${req.shift}`}>
          <div className="w-row">{fmt(req.date)}</div>
          <div className="w-row"><span className="chip">{t(req.shift)}</span>{req.times.start} ~ {req.times.end}</div>
          <div className="w-row">{factory(req.place.factoryId, req.place.factory)} {req.place.code}</div>
        </div>
        <button className="w-btn primary big" disabled={busy} onClick={() => respond(true)}>{t('willGo')}</button>
        <button className="w-btn outline" disabled={busy} onClick={() => respond(false)}>{t('cantCome')}</button>
        {error}
        <p className="w-note">{t('minLeft', { n: Math.max(1, Math.ceil((Date.parse(req.expiresAt) - serverNow()) / 60000)) })}</p>
      </div>
    );
  }

  const today = v.today;
  const reported = today.status === 'absent' || today.status === 'leave';
  const place = today.place
    ? `${factory(today.place.factoryId, today.place.factory)} ${today.place.code}`
    : factory(today.factoryId, today.factory);
  const STATUS: Record<string, string> = { pending: t('pending'), approved: t('approved'), rejected: t('rejected') };

  return (
    <div className="w-wrap">
      {top}
      <div className="w-name">{t('hello', { name: v.me.name })}</div>
      <div className="w-label">{t('todayWork')} · {fmt(today.date)}</div>
      {reported ? (
        <div className="w-card off"><div className="w-big">{t('alreadyReported')}</div></div>
      ) : today.shift ? (
        <div className={`w-card ${today.shift}`}>
          <span className="chip">{t(today.shift)}</span>
          <div className="w-time">{today.times.start} ~ {today.times.end}</div>
          <div className="w-place">{place}</div>
        </div>
      ) : (
        <div className="w-card off"><div className="w-big">{t('noWorkToday')}</div></div>
      )}
      {today.shift && !reported && (today.canReport
        ? <button className="w-btn danger big" disabled={busy} onClick={() => send({ type: 'report' }, () => setView({ k: 'done', msg: 'reported', sub: 'reportedSub', undo: true }))}>{t('cantGo')}</button>
        : <p className="w-note warn">{t('deadlinePassed')}</p>)}
      <button className="w-btn primary" onClick={() => setView({ k: 'leave' })}>{t('leave')}</button>
      <button className="w-btn outline" onClick={() => setView({ k: 'history' })}>{t('history')}</button>
      {error}
      {v.leaves.length > 0 && (
        <div className="w-leaves">
          <div className="w-label">{t('myLeaves')}</div>
          {v.leaves.map((l: Any) => (
            <div key={l.id} className="w-leave-row">
              <span>{fmt(l.date)}</span>
              <span className={`badge ${l.status === 'approved' ? 'badge-ok' : l.status === 'rejected' ? 'badge-danger' : 'badge-wait'}`}>{STATUS[l.status]}</span>
              {l.status === 'pending' && <button className="btn btn-sm" disabled={busy} onClick={() => send({ type: 'leaveCancel', id: l.id })}>{t('cancelLeave')}</button>}
            </div>
          ))}
        </div>
      )}
      {!demo && <button className="w-link" style={{ marginTop: 12 }} onClick={() => setView({ k: 'password' })}>비밀번호 바꾸기</button>}
    </div>
  );
}

/** 개인 비밀번호 정하기(숫자 4~8자리). 실제 회사에서만 보인다. */
function PasswordView({ top, onDone, onHome, homeLabel }: { top: React.ReactNode; onDone: () => void; onHome: () => void; homeLabel: string }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState(false);
  void onDone;
  return (
    <div className="w-wrap">
      {top}
      <h1 className="w-title">비밀번호 바꾸기</h1>
      <div className="w-label">숫자 4~8자리로 정해 주세요</div>
      {ok ? (
        <div className="w-result"><div className="w-check" aria-hidden /><div className="msg">비밀번호를 바꿨습니다</div></div>
      ) : (
        <form onSubmit={async (e) => {
          e.preventDefault();
          try { await post('/api/worker', { type: 'password', next: pw }); setOk(true); } catch (e2) { setErr((e2 as Error).message); }
        }}>
          <input type="password" inputMode="numeric" maxLength={8} value={pw} onChange={(e) => setPw(e.target.value.replace(/\D/g, ''))} autoFocus aria-label="새 비밀번호"
            style={{ width: '100%', minHeight: 54, fontSize: 24, textAlign: 'center', letterSpacing: 6, borderRadius: 12, border: '1.5px solid var(--border)', marginBottom: 10 }} />
          {err && <p className="w-note warn">{err}</p>}
          <button className="w-btn primary" disabled={pw.length < 4}>바꾸기</button>
        </form>
      )}
      <button className="w-btn outline" onClick={onHome}>{homeLabel}</button>
    </div>
  );
}
