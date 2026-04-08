# 設計書: 最終テスト課題の修正（4件）

## 概要

smallright MCP サーバーの最終テストで発見された4つの課題を修正する。
主眼は「AIがページを正確に認識できるか」という UX 品質の向上であり、
コアロジック（`state-builder.ts` / `element-registry.ts` / `click.ts`）の局所的な修正に留める。

## 技術スタック

- TypeScript + Node.js（既存構成を変更しない）
- Playwright（ブラウザ操作層）

## アーキテクチャ

変更対象は以下の3ファイルのみ。相互依存はない。

```
src/
  core/
    state-builder.ts        ← 課題 U4（collapseSimilar の改善）
    element-registry.ts     ← 課題 U2（AmbiguousMatch にコンテキスト追加）
                            ← 課題 U1（空テキストボタンの補完）
  tools/
    click.ts                ← 課題 B1（URL 変化検知タイミング改善）
```

---

## 実装単位

### 単位1: collapseSimilar の集約判定改善（U4）— 最重要

- 対象ファイル: `src/core/state-builder.ts`
- 並列可否: 他の単位と並列実装可能

#### 変更内容

`collapseSimilar()` のグルーピングキーにテキストパターン分類を追加する。
「テキストが意味的に多様な要素（ナビゲーションリンク等）」は集約しない。
「テキストが反復パターンの要素（日付・数字・空テキスト等）」のみ集約する。

**追加するヘルパー関数 `classifyTextPattern(text: string): string`**

テキストを以下の2パターンに分類し、パターン文字列を返す。
同じパターン文字列を持つ要素だけが同一グループに入れる。

| 判定条件 | 返す文字列 |
|---|---|
| テキストが20文字以下、かつ数字・日本語日付・曜日・記号のみで構成される（`/^[\d年月日曜火水木金土\s:\/\-.]+$/` に一致）| `"repetitive"` |
| 上記に該当しない（固有テキストあり）| `"unique:<正規化テキスト>"` — グループが1要素になり集約されない |

グルーピングキーを `${el.tag}|${el.role ?? ''}|${el.type ?? ''}|${el.disabled}|${classifyTextPattern(el.text)}` に変更する。

`"unique:..."` キーは各要素で異なる文字列になるため、グループが1要素になり、集約閾値（10件）に届かない。

---

### 単位2: URL 変化検知タイミングの改善（B1）

- 対象ファイル: `src/tools/click.ts`
- 並列可否: 他の単位と並列実装可能

#### 変更内容

`waitForTimeout(800)` と `waitForLoadState('domcontentloaded')` を廃止し、URLポーリング方式に変更する。

修正後の流れ:
```
click → URLポーリング（最大2秒、100msごと） → DOM安定待ち（300ms） → scan()
```

```typescript
// click後、URLが変わるかポーリング（最大2秒）
const maxWait = 2000;
const interval = 100;
let elapsed = 0;
while (elapsed < maxWait && page.url() === urlBefore) {
  await page.waitForTimeout(interval);
  elapsed += interval;
}
// URL変わらなくても続行（click後にDOMだけ変わるケースもある）
await page.waitForTimeout(300); // DOM安定待ち
```

これにより SPA の `history.pushState` が遅延実行される場合でも、URL 変化を確実に捉えてから後続処理に進める。
URL が変わらない場合（DOM 更新のみのケース）も 300ms のDOM安定待ちで対応する。

---

### 単位3: AmbiguousMatch への周辺コンテキスト追加（U2）

- 対象ファイル: `src/core/element-registry.ts`、`src/types.ts`
- 並列可否: 他の単位と並列実装可能

#### 変更内容

**`types.ts`**

`AmbiguousMatch.candidates` の各要素に `context?: string` フィールドを追加する。

```typescript
export interface AmbiguousMatch {
  query: string;
  candidates: Array<{
    text: string;
    tag: string;
    zone?: string;
    index: number;
    context?: string;   // 追加
  }>;
  message: string;
}
```

**`element-registry.ts`**

`InteractiveElement` に `context?: string` フィールドを追加し、`scan()` 内のブラウザ評価部分でコンテキストを取得する。

コンテキスト取得ロジック（ブラウザ側 `evaluate` 内）:
1. 要素の祖先を順に辿り、各祖先の直接の子要素から見出し（`h1`〜`h4`）を探す
2. 見つからない場合、`closest('section, article, [role="region"]')` の `aria-label` を使う
3. 見つからない場合は `undefined`（無理にテキストを絞り出さない）

```javascript
// evaluate 内の追加コード（各要素の処理末尾）
let context: string | undefined;
let node = htmlEl.parentElement;
while (node && node !== document.body) {
  const heading = node.querySelector(':scope > h1, :scope > h2, :scope > h3, :scope > h4');
  if (heading && heading !== htmlEl) {
    context = heading.innerText?.trim().slice(0, 50);
    break;
  }
  node = node.parentElement;
}
if (!context) {
  const region = htmlEl.closest('section, article, [role="region"]');
  context = region?.getAttribute('aria-label')?.trim().slice(0, 50) || undefined;
}
```

**`types.ts` の `InteractiveElement` 変更**:

```typescript
export interface InteractiveElement {
  // ...既存フィールド...
  context?: string;   // 追加: 周辺コンテキスト（AmbiguousMatch での表示専用）
}
```

`context` は `AmbiguousMatch` の候補構築時のみ使用する。`toPublicElement` の除外リストに `context` を追加し、通常の状態出力（`buildActionModeState` 等）には含めない。

---

### 単位4: 空テキストボタンの補完（U1）

- 対象ファイル: `src/core/element-registry.ts`
- 並列可否: 他の単位と並列実装可能

#### 変更内容

`scan()` 内のテキスト解決ロジックを拡張する。現在の優先順位:

```
aria-label > innerText > title > data-testid > type > ''
```

修正後の優先順位（空テキストの場合に追加フォールバックを試みる）:

```
aria-label > innerText > title > data-testid > 子SVGのdata-testid > [icon] > type > ''
```

**ブラウザ側 `evaluate` 内の修正箇所**（現在の78行目付近）:

```typescript
// 変更前
const text = ariaLabel?.trim() || innerText || titleAttr?.trim() || testId || typeAttr || '';

// 変更後
let svgIconName: string | undefined;
if (!ariaLabel && !innerText && !titleAttr && !testId) {
  // MUI は SVG アイコンに data-testid="XxxIcon" を付与する
  const svgTestId = htmlEl.querySelector('svg[data-testid]')?.getAttribute('data-testid');
  if (svgTestId) {
    // "DeleteIcon" → "Delete", "AddCircleIcon" → "AddCircle"
    svgIconName = svgTestId.replace(/Icon$/, '');
  }
}
const iconFallback = svgIconName ? `[${svgIconName}]` : ((!ariaLabel && !innerText && !titleAttr && !testId) ? '[icon]' : undefined);
const text = ariaLabel?.trim() || innerText || titleAttr?.trim() || testId || iconFallback || typeAttr || '';
```

これにより:
- MUI の `<DeleteIcon data-testid="DeleteIcon">` → `text: "[Delete]"`
- aria-label も SVG testid もない完全不明アイコン → `text: "[icon]"`
- 通常の `type="submit"` ボタン → 既存通り `text: "submit"`

---

## データモデル変更

`types.ts` への変更をまとめる:

```typescript
// InteractiveElement に追加
context?: string;   // 周辺コンテキスト（AmbiguousMatch での表示専用、toPublicElement では除外）

// AmbiguousMatch.candidates に追加
context?: string;   // 各候補の周辺コンテキスト
```

---

## リスク・注意点

- **単位1（U4）の `classifyTextPattern`**: 正規表現 `/^[\d年月日曜火水木金土\s:\/\-.]+$/` でカバーできない反復パターン（英語曜日等）は `"unique:..."` にフォールバックするため、集約されない（安全方向に倒れる）。必要に応じてパターンを拡張する。

- **単位2（B1）のポーリング方式**: 最大2秒のポーリング後、URL が変わらなくても続行する。DOM のみ変わるケース（モーダル表示等）でも 300ms のDOM安定待ちで対応できるが、重い非同期処理の場合は不足する可能性がある。汎用 MCP としては現修正で許容範囲とする。

- **単位3（U2）の `context` フィールド**: 祖先を辿る探索のため、DOM 構造が深い場合に意図しない見出しを拾う可能性がある。最大50文字の切り捨てで影響を限定する。`toPublicElement` で除外するため、通常の状態出力への副作用はない。

- **単位4（U1）の SVG `data-testid` 探索**: MUI 特有の挙動への依存。他UIライブラリ（Ant Design、Chakra等）では `data-testid` が付かない場合がある。その場合は `[icon]` フォールバックが機能するため問題なし。

- **`types.ts` の変更（単位3）**: `AmbiguousMatch` と `InteractiveElement` への追加フィールドは `optional` なので、既存の呼び出し元への破壊的変更はない。
