import { describe, it, expect } from 'vitest';
import {
  classifyTextPattern,
  collapseSimilar,
  toPublicElement,
} from '../core/state-builder.js';
import type { InteractiveElement, PublicElement } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLink(text: string, index = 0): PublicElement {
  return { tag: 'a', text, disabled: false };
}

function makeEl(overrides: Partial<InteractiveElement> = {}): InteractiveElement {
  return {
    ref: 'e1',
    tag: 'button',
    text: 'Click me',
    disabled: false,
    selector: '#btn',
    scanIndex: 0,
    context: 'Section heading',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// classifyTextPattern
// ---------------------------------------------------------------------------

describe('classifyTextPattern', () => {
  it('空文字は "repetitive" を返す', () => {
    expect(classifyTextPattern('')).toBe('repetitive');
  });

  it('undefined は "repetitive" を返す', () => {
    expect(classifyTextPattern(undefined)).toBe('repetitive');
  });

  it('日付文字列は "repetitive" を返す', () => {
    expect(classifyTextPattern('2026年4月8日')).toBe('repetitive');
    expect(classifyTextPattern('2026/04/08')).toBe('repetitive');
    expect(classifyTextPattern('12:30')).toBe('repetitive');
  });

  it('通常テキストは "unique:<text>" を返す', () => {
    expect(classifyTextPattern('ログイン')).toBe('unique:ログイン');
    expect(classifyTextPattern('メニュー名')).toBe('unique:メニュー名');
  });
});

// ---------------------------------------------------------------------------
// collapseSimilar
// ---------------------------------------------------------------------------

describe('collapseSimilar', () => {
  it('10件未満はそのまま返す', () => {
    const items: PublicElement[] = Array.from({ length: 9 }, (_, i) =>
      makeLink(`Link ${i}`)
    );
    const result = collapseSimilar(items);
    expect(result).toHaveLength(9);
  });

  it('同一グループ10件以上は先頭3件 + サマリー行に折りたたむ', () => {
    // 日付テキストは全て "repetitive" → 同一グループ扱い
    const items: PublicElement[] = Array.from({ length: 10 }, (_, i) =>
      makeLink(`2026年${i + 1}月1日`)
    );
    const result = collapseSimilar(items);
    // 先頭 3件 + サマリー 1件 = 4件
    expect(result).toHaveLength(4);
    const summary = result[3];
    expect(summary.text).toMatch(/^\.\.\.and 7 more similar elements$/);
  });

  it('異なるテキストを持つ<a>10件は折りたたまれない', () => {
    // 各テキストが unique:<text> で全て異なるグループ → 折りたたまれない
    const items: PublicElement[] = Array.from({ length: 10 }, (_, i) =>
      makeLink(`メニュー項目${i}`)
    );
    const result = collapseSimilar(items);
    expect(result).toHaveLength(10);
  });
});

// ---------------------------------------------------------------------------
// toPublicElement
// ---------------------------------------------------------------------------

describe('toPublicElement', () => {
  it('ref, selector, scanIndex, context が除外される', () => {
    const el = makeEl({
      ref: 'e42',
      selector: '#my-btn',
      scanIndex: 5,
      context: 'Some heading',
      tag: 'button',
      text: 'Submit',
      disabled: false,
    });
    const pub = toPublicElement(el);

    expect((pub as Record<string, unknown>).ref).toBeUndefined();
    expect((pub as Record<string, unknown>).selector).toBeUndefined();
    expect((pub as Record<string, unknown>).scanIndex).toBeUndefined();
    expect((pub as Record<string, unknown>).context).toBeUndefined();
  });

  it('公開フィールドは保持される', () => {
    const el = makeEl({
      tag: 'input',
      type: 'text',
      text: 'Name',
      label: 'お名前',
      placeholder: '山田太郎',
      disabled: false,
      value: 'foo',
    });
    const pub = toPublicElement(el);

    expect(pub.tag).toBe('input');
    expect(pub.type).toBe('text');
    expect(pub.text).toBe('Name');
    expect(pub.label).toBe('お名前');
    expect(pub.placeholder).toBe('山田太郎');
    expect(pub.disabled).toBe(false);
    expect(pub.value).toBe('foo');
  });
});
