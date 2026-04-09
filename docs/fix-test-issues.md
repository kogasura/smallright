# 設計書: テスト発見課題の修正

## 概要

URANUS2 の比較テスト中に発見された2つの課題を修正する。

- **課題1**: AmbiguousMatch 頻発（`<a>` と `<div role="button">` が同テキストでマッチ）
- **課題2**: navigate 直後の read_page で actions/formFields が空になる（SPA 初期化待機の誤検知）

## 技術スタック

- TypeScript（既存構成を維持）
- Playwright（既存）
- 変更対象: `src/core/element-registry.ts`, `src/core/browser-manager.ts`, `src/tools/navigate.ts`

---

## アーキテクチャ

```
click(text, role?) → resolveByText(role?) → フィルタ後候補を優先度ソート → AmbiguousMatch or single
navigate(url)      → navigateTo → waitForSpaReady(改善版) → scan → state
```

---

## 課題1: AmbiguousMatch が頻発する

### 原因

`resolveByText` は候補全員を `pickBestMatches` で絞った後、複数残れば即 AmbiguousMatch を返す。  
URANUS2 のサイドメニューは `<a>ユーザー一覧</a>` の中に `<div role="button">ユーザー一覧</div>` が入れ子になっているケースが多く、どちらも同テキストで exact match する。

### 修正方針

1. `resolveByText` に `role` パラメータを追加する
2. `role` が指定された場合、candidates を対象ロールのみにフィルタする
3. `role` が未指定の場合でも複数候補が残ったとき、ネイティブ要素（`a`, `button`, `input`）を ARIA ロール要素（`role="button"` 等を持つ `div`/`span`）より優先し、1つに絞れたら AmbiguousMatch を返さない
4. 優先度適用後も複数残る場合のみ AmbiguousMatch を返す

### 優先度定義

| 優先度 | 条件                                                      |
|--------|-----------------------------------------------------------|
| 1      | タグが `a` または `button`（ネイティブインタラクティブ）  |
| 2      | タグが `input`, `select`, `textarea`                      |
| 3      | `role` 属性が `button` または `link`（ARIA ロール要素）   |
| 4      | それ以外（`[onclick]`, `[tabindex]` 等）                  |

---

## 課題2: navigate 直後の read_page が空になる

### 原因

`waitForSpaReady` は `INTERACTIVE_SELECTOR` にマッチする要素数が 1 以上になった時点で即 return する。  
Next.js の SSR/CSR 遷移では、ローディング画面（プログレスバー等）に含まれる `button` や `a` が先に DOM に現れ、本コンテンツの描画完了前に waitForSpaReady が終了してしまう。  
その後 `navigate` が返す state は本コンテンツを含むが、AIが続けて `read_page` を呼ぶと内部で `waitForSpaReady` をもう一度呼ぶため、同じタイミング（ローディング中）に当たって空になるケースがある。

加えて `read_page` はゾーン未定義時のみ `waitForSpaReady` を呼ぶ（14〜21行目）が、ゾーン定義済み環境では SPA 待機なしで `getZoneSnapshot` を即時実行するため、ゾーン使用時も同様に空になり得る。

### 修正方針

`waitForSpaReady` の終了条件を「要素数安定方式」に変更する。  
ローディング中は DOM 上のインタラクティブ要素数が変動するため、要素数が 300ms 間安定していることをもって描画完了と判断する。  
クラス名ヒューリスティック（loading/spinner/progress 判定）および `evaluateAll` は廃止し、より汎用的かつパフォーマンスの高い実装に置き換える。

アプローチ: **要素数安定方式**を採用する。

1. `INTERACTIVE_SELECTOR` にマッチする要素数をポーリングする
2. 要素数が 1 以上の状態で、前回と同じ数が 3 回連続した場合（100ms 間隔 × 3 = 300ms 安定）で終了とする
3. タイムアウトは現行と同じ `SMALLRIGHT_WAIT_TIMEOUT`（デフォルト 10000ms）を使用する

```typescript
let prevCount = 0;
let stableCount = 0;
while (Date.now() - start < timeout) {
  const count = await page.locator(INTERACTIVE_SELECTOR).count();
  if (count > 0) {
    if (count === prevCount) { stableCount++; } else { stableCount = 0; }
    if (stableCount >= 3) return;  // 300ms安定で確定
    prevCount = count;
  }
  await page.waitForTimeout(100);
}
```

---

## 実装単位

### 単位1: resolveByText にロールフィルタ・優先度ソート・入れ子重複排除を追加

並列可否: **並列実行可**（単位2と依存なし）

対象ファイル:
- `src/core/element-registry.ts`
- `src/tools/batch-executor.ts`

変更内容:

1. `resolveByText` のシグネチャに `role?: string` を追加する
   ```typescript
   resolveByText(
     query: string,
     elements: InteractiveElement[],
     zone?: string,
     index?: number,
     role?: string,  // 追加
   ): InteractiveElement | AmbiguousMatch | null
   ```

2. `pickBestMatches` で candidates を取得した後、`role` が指定されていれば `ROLE_TAG_MAP` を使ってフィルタする
   ```typescript
   const ROLE_TAG_MAP: Record<string, string> = { button: 'button', link: 'a', menuitem: 'li' };

   let candidates = pickBestMatches(exact, prefix, partial);
   if (role) {
     const roleFiltered = candidates.filter(
       (e) => e.role === role || e.tag === ROLE_TAG_MAP[role]
     );
     if (roleFiltered.length > 0) candidates = roleFiltered;
   }
   ```

3. `role` 未指定かつ複数候補のとき、`prioritizeInteractive` でネイティブ要素を優先する関数を追加する
   ```typescript
   function interactivePriority(e: InteractiveElement): number {
     if (e.tag === 'a' || e.tag === 'button') return 1;
     if (e.tag === 'input' || e.tag === 'select' || e.tag === 'textarea') return 2;
     if (e.role === 'button' || e.role === 'link') return 3;
     return 4;
   }

   function prioritizeInteractive(candidates: InteractiveElement[]): InteractiveElement[] {
     if (candidates.length <= 1) return candidates;
     const sorted = [...candidates].sort(
       (a, b) => interactivePriority(a) - interactivePriority(b)
     );
     const best = interactivePriority(sorted[0]);
     return sorted.filter((e) => interactivePriority(e) === best);
   }
   ```

4. `resolveByText` 内で `role` 未指定の場合に `prioritizeInteractive` を呼ぶ
   ```typescript
   if (!role) {
     candidates = prioritizeInteractive(candidates);
   }
   ```

5. `scan()` の evaluate 内で入れ子要素の重複を排除する。`unique` 配列構築時に、既に追加済みの要素の子孫かつ同テキストの要素をスキップする:
   ```typescript
   // evaluate内、unique配列構築ループで
   if (unique.some(u => u.contains(node) && u.innerText?.trim() === (node as HTMLElement).innerText?.trim())) continue;
   ```
   親要素を残し、子要素を除外する。これにより `<a>テキスト<div role="button">テキスト</div></a>` で `<a>` のみが残る。

6. `read-page.ts` のゾーン定義済みパスにも `waitForSpaReady` を追加する（`getZoneSnapshot` 前に呼ぶ）。

対象インターフェース（`src/types.ts`）:
- `ElementRegistry.resolveByText` のシグネチャに `role?: string` を追加する

対象ツール（`src/tools/click.ts`）:
- `resolveByText` の呼び出しに `params.role` を渡す
  ```typescript
  const resolved = s.elements.resolveByText(
    params.text, elements, params.zone, params.index, params.role
  );
  ```

対象ツール（`src/tools/batch-executor.ts`）:
- `resolveByText` の呼び出し箇所に `role` を渡す対応を行う
- `role` 未指定でも `prioritizeInteractive` が動作するため、既存のバッチステップは動作変化なし

---

### 単位2: waitForSpaReady の終了条件を要素数安定方式に変更

並列可否: **並列実行可**（単位1と依存なし）

対象ファイル:
- `src/core/browser-manager.ts`

変更内容:

`waitForSpaReady` の内部ループを要素数安定方式に置き換える。クラス名ヒューリスティック（loading/spinner/progress 判定）および `evaluateAll` を廃止し、要素数が 300ms 安定することを終了条件とする。

```typescript
async waitForSpaReady(page: Page): Promise<void> {
  const raw = parseInt(process.env['SMALLRIGHT_WAIT_TIMEOUT'] ?? '10000', 10);
  const timeout = Number.isNaN(raw) || raw <= 0 ? 10000 : raw;
  const start = Date.now();

  let prevCount = 0;
  let stableCount = 0;

  while (Date.now() - start < timeout) {
    try {
      const count = await page.locator(INTERACTIVE_SELECTOR).count();
      if (count > 0) {
        if (count === prevCount) { stableCount++; } else { stableCount = 0; }
        if (stableCount >= 3) return;  // 300ms安定で確定
        prevCount = count;
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes('closed')) return;
      throw e;
    }
    await page.waitForTimeout(100);
  }
  // timeout - continue without error
}
```

---

## 検討事項

### navigate の空コンテンツ警告（単位2完了後に判断）

単位2の修正で課題2が解消された場合、本対応は不要。解消されない場合に限り、以下を追加実装する。

対象ファイル: `src/tools/navigate.ts`

`buildActionModeState` 後に `actions` と `formFields` が両方空の場合、AI に再取得を促す `hint` フィールドを追加する。

```typescript
const state = await s.state.buildActionModeState(page, elements);
const isEmpty = state.actions.length === 0 && state.formFields.length === 0;

const responseObj = isEmpty
  ? { ...state, hint: 'SPA still loading. Call read_page() to retrieve the page content after rendering completes.' }
  : state;

const responseJson = JSON.stringify(responseObj, null, 2);
```

---

## リスク・注意点

- **課題1の優先度ロジック**: URANUS2 以外のサイトで `<a>` が不正確な場合（アイコンのみの `<a>` など）にネイティブ要素が優先されると意図しない要素がクリックされる可能性がある。`index` パラメータで従来通り上書きできるため致命的ではない。

- **課題2の安定判定**: 要素数が意図的に変動するアニメーション（ステッパー等）を持つページでは、安定まで時間がかかる可能性がある。タイムアウト後は従来通り続行するため、最悪でも 10 秒待って返るだけ。

- **`resolveByText` のシグネチャ変更は破壊的変更**: `ElementRegistry` インターフェースの変更なので `types.ts` も同時に更新すること（単位1でまとめて対応）。
