import { describe, it, expect } from 'vitest';
import { createElementRegistry } from '../core/element-registry.js';
import type { InteractiveElement } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _refCounter = 0;
function makeElement(overrides: Partial<InteractiveElement> & Pick<InteractiveElement, 'tag' | 'text'>): InteractiveElement {
  _refCounter++;
  return {
    ref: `e${_refCounter}`,
    disabled: false,
    scanIndex: _refCounter - 1,
    ...overrides,
  };
}

const registry = createElementRegistry();

// ---------------------------------------------------------------------------
// resolveByText
// ---------------------------------------------------------------------------

describe('resolveByText', () => {
  it('完全一致1件 → InteractiveElement を直接返す', () => {
    const elements: InteractiveElement[] = [
      makeElement({ tag: 'button', text: 'ログイン' }),
      makeElement({ tag: 'button', text: '新規登録' }),
    ];
    const result = registry.resolveByText('ログイン', elements);
    expect(result).not.toBeNull();
    expect('text' in result!).toBe(true);
    const el = result as InteractiveElement;
    expect(el.text).toBe('ログイン');
  });

  it('完全一致が prefix より優先される', () => {
    const elements: InteractiveElement[] = [
      makeElement({ tag: 'a', text: 'ログイン' }),
      makeElement({ tag: 'a', text: 'ログインして続ける' }),
    ];
    const result = registry.resolveByText('ログイン', elements);
    const el = result as InteractiveElement;
    expect(el.text).toBe('ログイン');
  });

  it('複数一致 → AmbiguousMatch を返す', () => {
    const elements: InteractiveElement[] = [
      makeElement({ tag: 'button', text: '削除' }),
      makeElement({ tag: 'a', text: '削除' }),
    ];
    const result = registry.resolveByText('削除', elements);
    expect(result).not.toBeNull();
    // AmbiguousMatch has `candidates` array
    expect('candidates' in result!).toBe(true);
    const amb = result as { candidates: unknown[] };
    expect(amb.candidates).toHaveLength(2);
  });

  it('index 指定で候補を選択できる', () => {
    const elements: InteractiveElement[] = [
      makeElement({ tag: 'button', text: '削除' }),
      makeElement({ tag: 'a', text: '削除' }),
    ];
    const result = registry.resolveByText('削除', elements, undefined, 1);
    const el = result as InteractiveElement;
    expect(el.tag).toBe('a');
  });

  it('一致なし → null を返す', () => {
    const elements: InteractiveElement[] = [
      makeElement({ tag: 'button', text: 'ホーム' }),
    ];
    const result = registry.resolveByText('存在しないテキスト', elements);
    expect(result).toBeNull();
  });

  it('role 指定でフィルタリングされる', () => {
    const elements: InteractiveElement[] = [
      makeElement({ tag: 'button', text: '送信' }),
      makeElement({ tag: 'a', text: '送信', role: 'link' }),
    ];
    // role: 'link' → <a> のみ残る
    const result = registry.resolveByText('送信', elements, undefined, undefined, 'link');
    const el = result as InteractiveElement;
    expect(el.tag).toBe('a');
  });

  it('prioritizeInteractive: <a> が [role="button"] より優先される', () => {
    const elements: InteractiveElement[] = [
      makeElement({ tag: 'div', text: 'クリック', role: 'button' }),
      makeElement({ tag: 'a', text: 'クリック' }),
    ];
    const result = registry.resolveByText('クリック', elements);
    const el = result as InteractiveElement;
    expect(el.tag).toBe('a');
  });
});

// ---------------------------------------------------------------------------
// resolveByLabel
// ---------------------------------------------------------------------------

describe('resolveByLabel', () => {
  it('label フィールドが text より優先される', () => {
    const elements: InteractiveElement[] = [
      makeElement({ tag: 'input', text: 'メールアドレス', label: 'メール' }),
      makeElement({ tag: 'input', text: 'メール' }),
    ];
    // query "メール" → label完全一致(score=0) の最初の要素が優先
    const result = registry.resolveByLabel('メール', elements);
    const el = result as InteractiveElement;
    expect(el.label).toBe('メール');
  });

  it('label なし・text なしでも placeholder で解決できる', () => {
    const elements: InteractiveElement[] = [
      makeElement({ tag: 'input', text: '', placeholder: 'メールアドレスを入力' }),
    ];
    const result = registry.resolveByLabel('メールアドレスを入力', elements);
    expect(result).not.toBeNull();
    const el = result as InteractiveElement;
    expect(el.placeholder).toBe('メールアドレスを入力');
  });

  it('一致なし → null を返す', () => {
    const elements: InteractiveElement[] = [
      makeElement({ tag: 'input', text: 'ユーザー名' }),
    ];
    const result = registry.resolveByLabel('存在しないラベル', elements);
    expect(result).toBeNull();
  });

  it('複数一致 → AmbiguousMatch を返す', () => {
    const elements: InteractiveElement[] = [
      makeElement({ tag: 'input', text: 'パスワード', label: 'パスワード' }),
      makeElement({ tag: 'input', text: 'パスワード確認', label: 'パスワード' }),
    ];
    const result = registry.resolveByLabel('パスワード', elements);
    expect(result).not.toBeNull();
    expect('candidates' in result!).toBe(true);
  });
});
