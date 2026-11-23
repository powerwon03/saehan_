import { describe, expect, it } from 'vitest';
import { DICT, LANG_NAMES, LANGS, tr, weekday, type DictKey } from '@/lib/i18n';
import { LANG_LABEL } from '@/lib/labels';

const KEYS = Object.keys(DICT.ko) as DictKey[];
const holes = (text: string) => (text.match(/\{[a-z]+\}/g) ?? []).sort();

describe('근무자 화면 문구', () => {
  it('고를 수 있는 언어에 네팔어가 있고 이름표가 붙어 있다', () => {
    expect(LANGS).toContain('ne');
    expect(LANG_NAMES.ne).toBe('नेपाली');
    expect(LANG_LABEL.ne).toBe('네팔어');
    for (const l of LANGS) expect(LANG_NAMES[l]).toBeTruthy();
  });

  it('모든 언어가 같은 문구를 빠짐없이 갖고, 채울 자리({name} 등)도 같다', () => {
    for (const l of LANGS) {
      for (const k of KEYS) {
        expect(DICT[l][k], `${l}.${k}`).toBeTruthy();
        expect(holes(DICT[l][k]), `${l}.${k}`).toEqual(holes(DICT.ko[k]));
      }
      expect(DICT[l].weekdays.split(','), `${l}.weekdays`).toHaveLength(7);
    }
  });

  it('네팔어로 문구를 고르고 자리를 채운다', () => {
    expect(tr('ne', 'hello', { name: '수닐' })).toBe('수닐 ज्यू');
    expect(tr('ne', 'minLeft', { n: 20 })).toContain('20');
    expect(weekday('ne', 0)).toBe('आइत');
  });
});
