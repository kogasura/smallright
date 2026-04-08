# 設計書: MCPサーバー テスト発見課題の修正

## 概要

smallright MCPサーバーの実動作テストで発見された以下3課題を修正する。

1. SPA初期化の待機がない（navigate後にactions/formFieldsが空になる）
2. React onClickが発火しない（data-smallright-ref属性付与によるDOM汚染）
3. ダイアログ処理がない（alertが出ると操作不能になる）

## 技術スタック

- 既存: TypeScript + Playwright + MCP SDK
- 変更なし（追加ライブラリ不要）

## アーキテクチャ

変更対象レイヤーの整理:

```
tools/navigate.ts        <- 課題1: scan前にSPA待機を挿入
tools/read-page.ts       <- 課題1: scan前にSPA待機を挿入
core/browser-manager.ts  <- 課題1: waitForSpaReady() メソッド追加
                         <- 課題3: newPage()時にdialogハンドラを登録
core/element-registry.ts <- 課題2: data-smallright-ref属性付与を廃止、nth-indexベースセレクタに変更
                         <- 課題2: INTERACTIVE_SELECTOR を export
core/locator-helper.ts   <- 課題2: resolveLocator() ヘルパー新規作成
tools/click.ts           <- 課題2: resolveLocator() を呼ぶだけに変更
```

## 実装単位

### 単位1: SPA待機ロジックの追加 (課題1)

**並列可否**: 単位2と並列実装可能

**対象ファイル**:
- `src/core/browser-manager.ts`
- `src/tools/navigate.ts`
- `src/tools/read-page.ts`
- `src/types.ts`（インターフェース追加）

**変更内容**:

#### `src/core/browser-manager.ts`

`waitForSpaReady(page)` メソッドをクラスに追加する。

実装方針:
1. インタラクティブ要素セレクタ（`button, a, input, select, textarea`）が1件以上出現するまで100msポーリングで待機する。タイムアウトは環境変数 `SMALLRIGHT_WAIT_TIMEOUT`（ミリ秒、デフォルト 10000）
2. TimeoutError のみcatchしてそのまま返す。他の例外は再throwする

理由: networkidleはSPAで信頼性が低い（常時ポーリングするSPAでは長時間待つことになる）ため省略し、DOM出現チェック1本に簡素化する。

#### `src/tools/navigate.ts`

`s.browser.navigateTo()` 後、`s.elements.scan()` の前に `await s.browser.waitForSpaReady(page)` を挿入する。

#### `src/tools/read-page.ts`

zones未定義でフルスキャンするパス（既存コード24〜26行目）で、`scan()` の前に `await s.browser.waitForSpaReady(page)` を挿入する。zones定義済みパスはnavigate時の待機でカバーできるため変更不要。

#### `src/types.ts`

`BrowserManager` インターフェースに `waitForSpaReady(page: import('playwright').Page): Promise<void>` を追加する。

---

### 単位2: data-smallright-ref廃止とnthベースセレクタへの変更 (課題2)

**並列可否**: 単位1と並列実装可能

**対象ファイル**:
- `src/core/element-registry.ts`
- `src/core/locator-helper.ts`（新規作成）
- `src/tools/click.ts`
- `src/tools/fill.ts`
- `src/tools/select-option.ts`
- `src/tools/fill-form.ts`
- `src/tools/batch-executor.ts`
- `src/types.ts`（単位1と同一ファイル。まとめて変更すること）

**変更内容**:

#### `src/core/element-registry.ts`

`scan()` の `page.evaluate()` 内（82〜101行目）で `htmlEl.setAttribute('data-smallright-ref', dataRef)` を呼んでいる。
これがReact仮想DOMと実DOMの不一致を引き起こしてonClickが発火しない原因。

変更方針: DOM属性付与をやめる。scan結果配列内でのインデックスを `scanIndex` として返す。

evaluate内の変更箇所（IDなしの場合のセレクタ生成部）:
- 現在: `htmlEl.setAttribute('data-smallright-ref', dataRef)` でDOM汚染した後そのセレクタを返す
- 変更後: DOMには何も付与しない。IDがある場合は `selector = "#" + CSS.escape(id)` を返す。IDがない場合は `selector = undefined`、`scanIndex` = INTERACTIVE_SELECTOR でマッチした要素群（scan結果配列）内でのインデックスを返す

返却オブジェクトに `scanIndex` フィールドを追加する。IDセレクタを持つ要素は `scanIndex` 不要。

`INTERACTIVE_SELECTOR` を `export const` で export する。locator-helper.ts からこの値を import して使用する。

#### `src/core/locator-helper.ts`（新規作成）

`InteractiveElement` から Playwright `Locator` を生成するヘルパー関数 `resolveLocator` を定義する。

```typescript
// resolveLocator: InteractiveElement から Playwright Locator を生成
export function resolveLocator(page: Page, resolved: InteractiveElement): Locator
```

locator解決の優先順位:
1. `resolved.selector`（IDベース）がある → `page.locator(selector)`
2. `resolved.role` + `resolved.text` がある → `page.getByRole(role, { name: text })`
3. `resolved.text` がある → `page.getByText(text, { exact: true })`
4. `resolved.label` がある → `page.getByLabel(label)`
5. `resolved.scanIndex !== undefined` → `page.locator(INTERACTIVE_SELECTOR).nth(scanIndex)`
6. いずれも該当しない → `Error` を throw する

`INTERACTIVE_SELECTOR` は `element-registry.ts` から import する。

`escapeAttrValue`（属性値エスケープ用ユーティリティ）もこのファイルに定義し、click.ts・fill.ts・select-option.ts・fill-form.ts・batch-executor.ts に存在する重複実装をこちらに統合する。

#### `src/types.ts`

`InteractiveElement` に `scanIndex?: number` を追加する（internal useのため `PublicElement` の Omit には含めない）。

#### `src/tools/click.ts`

locator解決のロジックを削除し、`resolveLocator(page, resolved)` を呼ぶだけに変更する。

#### `src/tools/fill.ts` / `src/tools/select-option.ts` / `src/tools/fill-form.ts` / `src/tools/batch-executor.ts`

click.ts と同様に、locator解決のロジックを削除し `resolveLocator(page, resolved)` を呼ぶだけに変更する。

また、batch-executor.ts 内の `navigate` ステップについても、遷移後かつ scan 前に `await s.browser.waitForSpaReady(page)` を挿入する。

---

### 単位3: ダイアログ自動処理の追加 (課題3)

**並列可否**: 単位1・2の実装後に統合する（browser-manager.ts・types.tsが重複するため）

**対象ファイル**:
- `src/core/browser-manager.ts`（単位1と統合）
- `src/types.ts`（単位1・2と統合）
- `src/tools/click.ts`（単位2と統合）
- `src/tools/fill.ts`（単位2と統合）
- `src/tools/select-option.ts`（単位2と統合）
- `src/tools/fill-form.ts`（単位2と統合）
- `src/tools/batch-executor.ts`（単位2と統合）
- `src/tools/navigate.ts`（単位1と統合）

**変更内容**:

#### `src/core/browser-manager.ts`

クラスフィールドとして `private lastDialogMessages: Array<{ type: string; message: string }> = []` を追加する。

`getPage()` 内の `browser.newPage()` 直後にダイアログイベントハンドラを登録する:
- `dialog.accept()` を呼んでダイアログを閉じる
- `this.lastDialogMessages` に追加する（push）

`consumeDialogMessages()` メソッドを追加する（全件返却して配列をクリアする）。

#### `src/types.ts`

`BrowserManager` インターフェースに `consumeDialogMessages(): Array<{ type: string; message: string }>` を追加する。

#### `src/tools/click.ts` / `src/tools/fill.ts` / `src/tools/select-option.ts` / `src/tools/fill-form.ts` / `src/tools/batch-executor.ts` / `src/tools/navigate.ts`

各ツールのレスポンス返却前に `s.browser.consumeDialogMessages()` を呼び、配列が空でない場合は結果JSONに `dialogs: Array<{ type, message }>` フィールドを追加して返す。これによりAIはalertの発生とメッセージ内容を認識してリカバリできる。

より良い実装として、アクション実行後のレスポンス構築を共通化するヘルパーに dialog 情報の付与を含めることを検討する（`resolveLocator` と同様の共通化パターン）。その場合は各ツールの個別実装を置き換える。

---

## データモデルの変更

### `InteractiveElement`（`src/types.ts`）

`scanIndex?: number` を追加する（内部用。PublicElementのOmitには含めない）。

### `BrowserManager`（`src/types.ts`）

`waitForSpaReady` と `consumeDialogMessages` の2メソッドを追加する。

---

## 実装順序サマリー

| 単位 | 対象ファイル | 並列可否 |
|------|------------|---------|
| 単位1: SPA待機 | browser-manager.ts, navigate.ts, read-page.ts, types.ts | 単位2と並列可 |
| 単位2: DOM汚染除去 | element-registry.ts, locator-helper.ts, click.ts, fill.ts, select-option.ts, fill-form.ts, batch-executor.ts, types.ts | 単位1と並列可 |
| 単位3: ダイアログ処理 | browser-manager.ts, types.ts, click.ts, fill.ts, select-option.ts, fill-form.ts, batch-executor.ts, navigate.ts | 単位1・2の実装後に統合 |

単位3は単位1・2と同一ファイルへの変更が複数あるため、1つのブランチにまとめてPRを作成することを推奨する。

---

## リスク・注意点

- **単位2のscanIndexベースセレクタ**: `page.locator(INTERACTIVE_SELECTOR).nth(scanIndex)` はscan時のDOM順に依存するため、クリック直前にDOMが変化している場合に別要素を指す可能性がある。ただし `data-smallright-ref` 方式も同じリスクを持つため実質的な退行はない
- **単位1のポーリング待機**: TimeoutError 以外の例外は再throwされるため、Playwright内部例外がある場合は呼び出し元に伝播する
- **単位3のconfirm自動accept**: confirmは常にacceptされるため、cancel前提のフロー（例: 削除確認でキャンセルを期待するケース）が意図せず進行する可能性がある
- **単位1のread_page待機省略**: read_page のゾーン定義済みパスではSPA待機が入らない。navigate時の待機でカバーする前提であり、zones定義済みパスに到達する前に必ずnavigate経由でページ遷移することを前提とする
- **単位3のbeforeunload**: `beforeunload` ダイアログを自動acceptするとページ遷移をブロックしない挙動になる。現時点では許容する。将来的に `handle_dialog` ツールとして dismiss/accept を選べるようにすることを検討する
