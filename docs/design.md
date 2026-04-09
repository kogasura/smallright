# 設計書: smallright — AI-Friendly Browser Automation MCP Server

## 概要

### 何を作るか
PlaywrightをラッピングするMCPサーバー。現状のPlaywright MCPは毎回ページ全体のDOMをAIに返すため、トークンを大量消費し操作も遅い。smallrightは「AIが本当に必要な情報だけを、必要な時に取得する」設計でこの問題を解決する。

### なぜ作るか
- 既存のPlaywright MCPはページ全DOMを返すためコンテキスト消費が大きい
- AIはCSSセレクタやref IDを意識すべきでない（テキスト・ラベル・ロールで操作できるべき）
- 繰り返し訪問するサイトのゾーン定義を永続化することで、毎回の検出コストを省ける
- バッチ実行により複数操作のMCPラウンドトリップを削減できる

### 核心コンセプト
- ページをゾーン（header/main/sidebar等）に分割し、必要なゾーンだけ取得する
- Action Mode（操作可能要素リスト + コンテンツ要約）とVisual Mode（フルDOM/スクリーンショット）を切り替える
- ドメイン単位のサイトプロファイルで学習結果をファイルに永続化する
- バッチ実行で往復回数を削減し、最終状態のみAIに返す

---

## 技術スタック

| 技術 | バージョン | 選定理由 |
|---|---|---|
| TypeScript (ESM) | 最新 | freee-mcp-soloと同じ構成、型安全 |
| `@modelcontextprotocol/sdk` | ^1.28.0 | freee-mcp-soloと同バージョン、`server.tool()` APIを使用 |
| `playwright` | 最新 | ブラウザ自動化。`locator().ariaSnapshot()`, `page.evaluate()` で部分DOM取得が可能 |
| `zod` | ^4.3.6 | スキーマ定義。freee-mcp-soloと同パターン |
| Transport | stdio | freee-mcp-soloと同様、`StdioServerTransport` |
| プロファイル保存 | ファイルシステム | `~/.config/smallright/profiles/{domain}.json` |

---

## アーキテクチャ

### 全体構成

```
Claude Code (AI)
    |  MCP stdio
    v
src/index.ts          <- エントリポイント (StdioServerTransport接続)
src/server.ts         <- McpServer生成 + 全ツール登録 + wrap()ヘルパー
    |
    +-- src/core/     <- ビジネスロジック層（ブラウザ・ゾーン・プロファイル管理）
    |   +-- browser-manager.ts    ブラウザ/ページのシングルトン管理 (Phase 1)
    |   +-- element-registry.ts   テキスト/ラベル -> Playwright locator 解決 (Phase 1)
    |   +-- state-builder.ts      ActionModeState / VisualModeState の構築 (Phase 1)
    |   +-- zone-manager.ts       ゾーン検出・キャッシュ・クエリ (Phase 3)
    |   +-- state-differ.ts       ゾーン単位のスナップショット差分検出 (Phase 2)
    |   +-- batch-executor.ts     バッチ実行エンジン（チェックポイント付き） (Phase 5)
    |   +-- profile-manager.ts    ドメインプロファイルCRUD（ファイルベース） (Phase 4)
    |
    +-- src/tools/    <- MCPツール層（1ファイル1ツール = 1ユースケース）
        +-- [高レベル] navigate, read-page, click, fill, fill-form,
        |              select-option, read-table, run-batch, screenshot
        +-- [中レベル] setup-page, define-zones, save-profile,
        |              list-profiles, delete-profile
        +-- [低レベル] evaluate, get-state
```

---

## データモデル

### 型定義（src/types.ts に全定義）

```typescript
// ゾーン
interface ZoneDefinition {
  name: string;           // "header", "main", "sidebar" 等
  selector: string;       // CSSセレクタ（内部用、AIには見せない）
  description?: string;
}

interface ZoneSnapshot {
  name: string;
  textContent: string;
  contentHash: string;    // 差分検出用
  interactiveElements: InteractiveElement[];
}

// 要素（ref IDは内部用。AIへのレスポンスには PublicElement を使う）
interface InteractiveElement {
  ref: string;            // 内部用（AIには非公開）
  tag: string;            // "button", "a", "input" 等
  type?: string;          // input type
  text: string;           // 表示テキスト or aria-label
  label?: string;         // 関連するlabelのテキスト（input用）
  placeholder?: string;
  value?: string;         // 現在値（input用）
  disabled: boolean;
  zone?: string;
}

type PublicElement = Omit<InteractiveElement, "ref">;

// ページ状態
interface ActionModeState {
  url: string;
  title: string;
  zones: Array<{ name: string; summary: string }>;
  actions: PublicElement[];      // ボタン・リンク
  formFields: PublicElement[];   // input・select・textarea
}

interface VisualModeState {
  url: string;
  title: string;
  dom: string;          // フルariaSnapshot
  screenshot?: string;  // Base64画像（オプション）
}

interface StateDiff {
  url: { changed: boolean; from?: string; to?: string };
  changedZones: ZoneSnapshot[];
  unchangedZones: string[];
}

// プロファイル（~/.config/smallright/profiles/{domain}.json）
interface SiteProfile {
  domain: string;
  zones: ZoneDefinition[];
  createdAt: string;
  updatedAt: string;
}

// バッチ（AIはテキスト/ラベルで要素を指定）
interface BatchStep {
  action: "click" | "fill" | "fill_form" | "select" | "navigate" | "wait";
  text?: string;
  label?: string;
  value?: string;
  fields?: Record<string, string>;
  url?: string;
  ms?: number;
}

interface BatchResult {
  success: boolean;
  stepsCompleted: number;
  totalSteps: number;
  finalState: ActionModeState;
  diff: StateDiff;
  error?: { stepIndex: number; message: string; stateAtError: ActionModeState };
}

// 曖昧マッチ時の候補返却
interface AmbiguousMatch {
  query: string;
  candidates: Array<{ text: string; tag: string; zone?: string; index: number }>;
  message: string;
}

// サービス集約（server.tsで生成し、各ツールに渡す）
// freee-mcp-soloでは依存が2つ(client, cache)なので個別引数で済むが、
// smallrightは依存が多いためサービスバッグパターンを採用する
interface Services {
  browser: BrowserManager;
  elements: ElementRegistry;
  state: StateBuilder;
  zones: ZoneManager;        // Phase 3で本実装、それ以前はスタブ
  differ: StateDiffer;       // Phase 2で本実装、それ以前はスタブ
  profiles: ProfileManager;  // Phase 4で本実装、それ以前はスタブ
  batch: BatchExecutor;      // Phase 5で本実装、それ以前はスタブ
}
```

### プロファイルファイル構造

```
~/.config/smallright/profiles/
+-- freee.co.jp.json
+-- github.com.json
+-- {domain}.json
```

---

## ツール設計

### 高レベルツール（AIが普段使うもの）

| ツール名 | ユースケース | 主要パラメータ | 返却値 |
|---|---|---|---|
| `navigate` | ページを開く | `url: string` | ActionModeState |
| `read_page` | 今のページを読む | `zone?: string` | ActionModeState（ゾーン自動判定） |
| `click` | 何かをクリック | `text: string`, `role?: string`, `zone?: string`, `index?: number` | StateDiff or AmbiguousMatch |
| `fill` | 1フィールドに入力 | `label: string`, `value: string` | StateDiff or AmbiguousMatch |
| `fill_form` | フォーム一括入力 | `fields: Record<string, string>` | StateDiff |
| `select_option` | ドロップダウン選択 | `label: string`, `value: string` | StateDiff |
| `read_table` | テーブルデータ取得 | `zone?: string`, `selector?: string` | JSON配列（行オブジェクト） |
| `run_batch` | 定型操作を一括実行 | `steps: BatchStep[]` | BatchResult |
| `screenshot` | 画面キャプチャ | `zone?: string`, `full_page?: boolean` | Base64画像 |

### 中レベルツール（ゾーン・プロファイル管理）

| ツール名 | ユースケース | 主要パラメータ | 返却値 |
|---|---|---|---|
| `setup_page` | ゾーン自動検出 + 結果取得 | なし | ZoneDefinition[]（提案） |
| `define_zones` | ゾーン定義を上書き | `zones: ZoneDefinition[]` | 確認メッセージ |
| `save_profile` | 現在のゾーン定義を保存 | `domain?: string` | 保存確認 |
| `list_profiles` | プロファイル一覧 | なし | プロファイルリスト |
| `delete_profile` | プロファイル削除 | `domain: string` | 削除確認 |

### 低レベルツール（フォールバック）

| ツール名 | ユースケース | 主要パラメータ | 返却値 |
|---|---|---|---|
| `evaluate` | カスタムJS実行 | `script: string` | スクリプト戻り値 |
| `get_state` | 生のページ状態 | `mode: "action" | "visual"` | ActionModeState or VisualModeState |

### 要素解決の仕組み（element-registry.ts）

click(text: "保存") が呼ばれると:
1. element-registry が全インタラクティブ要素からテキストマッチ
2. 1件ヒット: そのまま実行、StateDiff返却
3. 複数ヒット: AmbiguousMatch を返す（候補リスト + index指定の案内）
4. 0件: エラー（類似候補を付けて返す）

fill(label: "メールアドレス") も同様:
- label テキスト、placeholder、aria-label でマッチ

**テキストマッチの優先順位:**
1. 完全一致（正規化後）
2. 前方一致
3. 部分一致（含む）
4. 0件の場合: エラーメッセージを返す。エラーメッセージにはページ上の全インタラクティブ要素のテキスト一覧を添える

**正規化ルール:**
- 連続空白を1つに正規化
- 前後の空白をトリム
- 大文字小文字は区別しない

**ラベルマッチの検索対象（優先順位）:**
1. `<label>` のテキスト
2. `aria-label` 属性
3. `placeholder` 属性
4. `name` 属性


---

## コアロジック詳細

### ゾーン自動検出（zone-manager.ts: autoDetect）

page.evaluate() で以下のヒューリスティックを優先順位順に実行:

1. セマンティックHTML: `<header>`, `<nav>`, `<main>`, `<aside>`, `<footer>`
2. ARIAランドマーク: `[role="banner"]`, `[role="navigation"]`, `[role="main"]` 等
3. 一般的なCSS class/ID: `#header`, `.navbar`, `.sidebar`, `.main-content` 等
4. レイアウトヒューリスティック（フォールバック）: position/sizeベースで推定

重複排除 -> ZoneDefinition[] として返却 -> AIが確認/修正 -> ZoneManagerにセット

### バッチ実行フロー（batch-executor.ts）

```
初期スナップショット取得
for each step:
  try:
    アクション実行 (click/fill/select/navigate/wait)
    DOM安定待ち (domcontentloaded + 短タイムアウト)
    要素レジストリ再スキャン
    チェックポイント記録（メモリ内のみ、AIには返さない）
  catch:
    エラー時の状態をキャプチャ -> エラー情報付きで返却・処理終了
  曖昧マッチ（AmbiguousMatch）が発生した場合は、エラーとして扱い、error.message に候補リストを含めてそのステップで停止する
最終スナップショット取得
初期 -> 最終の StateDiff を計算して返却
```

### 差分検出（state-differ.ts）

- 各ゾーンの textContent のハッシュ値を比較
- 変更があったゾーン: 全内容を返す
- 変更なしのゾーン: 名前だけ返す

### ブラウザ設定（browser-manager.ts）

- デフォルト: headless（画面なし）
- `SMALLRIGHT_HEADLESS=false` 環境変数で headed に切替可能
- viewport: 1280x720

---

## 実装単位

### 単位1: プロジェクト基盤（Phase 1前半）

- 対象ファイル:
  - `package.json`
  - `tsconfig.json`
  - `src/types.ts`
- 変更内容:
  - `package.json`: `type: "module"`, `main: "dist/index.js"`, scripts（build/start/dev）, 依存関係（`@modelcontextprotocol/sdk` ^1.28.0, `playwright`, `zod` ^4.3.6, dev: `tsx`, `typescript`, `@types/node`）
  - `tsconfig.json`: ESM対応（`module: "ES2022"`, `moduleResolution: "bundler"`, `outDir: dist`, `strict: true`, `declaration: true`, `sourceMap: true`）
  - `src/types.ts`: プランファイルの型定義をすべてエクスポート（ZoneDefinition, ZoneSnapshot, InteractiveElement, PublicElement, ActionModeState, StateDiff, SiteProfile, BatchStep, BatchResult, AmbiguousMatch）
- 並列可否: 他単位と依存関係なし。最初に実施する

### 単位2: コア層 — ブラウザ管理と要素解決（Phase 1中盤）

- 対象ファイル:
  - `src/core/browser-manager.ts`
  - `src/core/element-registry.ts`
- 変更内容:
  - `browser-manager.ts`:
    - シングルトンパターンで Playwright `Browser` と `Page` を管理
    - `getBrowser(): Promise<Browser>` — 起動済みなら再利用
    - `getPage(): Promise<Page>` — 現在のページを返す
    - `navigateTo(url: string): Promise<void>` — ページ遷移 + DOM安定待ち
    - `SMALLRIGHT_HEADLESS` 環境変数の読み取り
  - `element-registry.ts`:
    - `scan(page: Page): Promise<InteractiveElement[]>` — ページ全体のインタラクティブ要素をスキャン
    - `resolveByText(query: string, elements: InteractiveElement[], zone?: string, index?: number): InteractiveElement | AmbiguousMatch | null` — テキストマッチ
    - `resolveByLabel(label: string, elements: InteractiveElement[], index?: number): InteractiveElement | AmbiguousMatch | null` — ラベルマッチ（label/placeholder/aria-label）
- 並列可否: 単位1が完了後に実施。2ファイルは独立しているため並列実装可能

### 単位3: コア層 — 状態構築（Phase 1中盤）

- 対象ファイル:
  - `src/core/state-builder.ts`
- 変更内容:
  - `buildActionModeState(page: Page, elements: InteractiveElement[], zones?: ZoneSnapshot[]): Promise<ActionModeState>` — url/title/zones/actions/formFields を構築
  - zones引数がない場合はゾーンなし版（空配列）として動作（Phase 1用）
  - `buildVisualModeState(page: Page): Promise<VisualModeState>` — フルDOM版（get-stateツール用）
- 並列可否: 単位2と独立。単位1完了後に並列実装可能

### 単位4: エントリポイントとサーバー骨格（Phase 1後半）

- 対象ファイル:
  - `src/index.ts`
  - `src/server.ts`
- 変更内容:
  - `index.ts`: freee-mcp-soloと同一パターン（StdioServerTransport + createMcpServer + main()）
  - `server.ts`:
    - `createMcpServer(): McpServer` — McpServer生成、instructions記述、全ツール登録
    - `wrap(fn: () => Promise<string>): Promise<ToolResult>` — freee-mcp-soloの wrap() と同一シグネチャ
    - BrowserManager / ElementRegistry / ZoneManager / ProfileManager / StateDiffer / StateBuilder / BatchExecutor の各インスタンスを生成し、`Services` オブジェクトとしてまとめる。各ツール関数には `(s: Services, params)` の2引数で統一的に渡す。ツール登録は `(params) => wrap(() => navigate(services, params))` の形で統一
    - Phase 1時点では navigate, read_page, get_state の3ツールのみ登録
- 並列可否: 単位2・3が完了後に実施

### 単位5: 高レベルツール — ナビゲートと読み取り（Phase 1完了）

- 対象ファイル:
  - `src/tools/navigate.ts`
  - `src/tools/read-page.ts`
  - `src/tools/get-state.ts`
- 変更内容:
  - `navigate.ts`:
    - `navigate(s: Services, params: { url: string }): Promise<string>`
    - URL遷移 -> プロファイル自動ロード（Phase 4で本実装、Phase 1はスタブ） -> 要素スキャン -> ActionModeStateをJSON文字列で返却
  - `read-page.ts`:
    - `readPage(s: Services, params: { zone?: string }): Promise<string>`
    - zone指定あり: 対象ゾーンのみ取得、zone指定なし: mainゾーン自動判定（ゾーンマネージャーが未設定なら全体）
  - `get-state.ts`:
    - `getState(s: Services, params: { mode: "action" | "visual" }): Promise<string>`
    - フォールバック用。modeに応じて ActionModeState または VisualModeState を返す
- 並列可否: 単位4完了後に3ファイルは並列実装可能
- 検証: `npm run dev` でMCP起動 -> `navigate` + `read_page` でコンテンツ+操作候補が返ること

### 単位6: 差分検出とアクションツール（Phase 2）

- 対象ファイル:
  - `src/core/state-differ.ts`
  - `src/tools/click.ts`
  - `src/tools/fill.ts`
  - `src/tools/fill-form.ts`
  - `src/tools/select-option.ts`
- 変更内容:
  - `state-differ.ts`:
    - `takeSnapshot(page: Page, zones: ZoneDefinition[]): Promise<ZoneSnapshot[]>` — 各ゾーンの textContent + hash + interactiveElements を取得
    - `computeDiff(before: ZoneSnapshot[], after: ZoneSnapshot[], urlBefore: string, urlAfter: string): StateDiff` — hash比較で変更ゾーンを特定
    - ゾーン未設定時はページ全体を1ゾーン（フォールバック）として扱う
  - `click.ts`:
    - `clickElement(s: Services, params: { text: string; role?: string; zone?: string; index?: number }): Promise<string>`
    - snapshot取得 -> 要素解決 -> locator.click() -> snapshot再取得 -> StateDiff返却
    - 曖昧マッチ時は AmbiguousMatch を返す
  - `fill.ts`:
    - `fillField(s: Services, params: { label: string; value: string }): Promise<string>`
  - `fill-form.ts`:
    - `fillForm(s: Services, params: { fields: Record<string, string> }): Promise<string>`
    - 各フィールドをラベルで順次解決・入力
  - `select-option.ts`:
    - `selectOption(s: Services, params: { label: string; value: string }): Promise<string>`
  - `server.ts` に上記ツールを追加登録する
- 並列可否: 単位5完了後に実施。state-differ.tsは他のツールの前提のため先行実装。click/fill/fill-form/select-optionは並列実装可能
- 検証: テキスト指定でクリック・入力が動くこと。曖昧マッチ時に候補が返ること

### 単位7: ゾーンシステム（Phase 3）

- 対象ファイル:
  - `src/core/zone-manager.ts`
  - `src/tools/setup-page.ts`
  - `src/tools/define-zones.ts`
- 変更内容:
  - `zone-manager.ts`:
    - インメモリキャッシュ（現在のZoneDefinition[]とZoneSnapshot[]）
    - `autoDetect(page: Page): Promise<ZoneDefinition[]>` — ヒューリスティック4段階でゾーン候補を検出
    - `setZones(zones: ZoneDefinition[]): void` — ゾーン定義をセット
    - `getZones(): ZoneDefinition[]` — 現在のゾーン定義を返す
    - `getZoneSnapshot(page: Page, zoneName: string): Promise<ZoneSnapshot>` — 特定ゾーンのスナップショット取得
  - `setup-page.ts`:
    - `setupPage(s: Services, params: Record<string, never>): Promise<string>` — autoDetect実行 -> ZoneDefinition[]をJSON文字列で返す
  - `define-zones.ts`:
    - `defineZones(s: Services, params: { zones: ZoneDefinition[] }): Promise<string>` — zoneManager.setZones()を呼ぶ
  - `state-builder.ts` と `read-page.ts` をゾーン対応に更新（zones引数を使うように修正）
- 並列可否: 単位6完了後に実施。setup-page/define-zonesはzone-manager.ts完成後に並列実装可能
- 検証: 実サイトでゾーン検出 -> mainゾーンだけ取得でコンテキスト削減を確認

### 単位8: プロファイル管理（Phase 4）

- 対象ファイル:
  - `src/core/profile-manager.ts`
  - `src/tools/save-profile.ts`
  - `src/tools/list-profiles.ts`
  - `src/tools/delete-profile.ts`
- 変更内容:
  - `profile-manager.ts`:
    - `load(domain: string): Promise<SiteProfile | null>` — `~/.config/smallright/profiles/{domain}.json` を読む
    - `save(domain: string, zones: ZoneDefinition[]): Promise<void>` — JSONファイルに書き込む（createdAt/updatedAt付与）
    - `list(): Promise<SiteProfile[]>` — プロファイルディレクトリ内の全JSONを読み込む
    - `delete(domain: string): Promise<void>` — ファイル削除
  - `save-profile.ts`: `saveProfile(s: Services, params: { domain?: string }): Promise<string>`
  - `list-profiles.ts`: `listProfiles(s: Services, params: Record<string, never>): Promise<string>`
  - `delete-profile.ts`: `deleteProfile(s: Services, params: { domain: string }): Promise<string>`
  - `navigate.ts` を更新: URL遷移時にドメインでプロファイルを自動ロードし ZoneManager に適用する
- 並列可否: 単位7完了後に実施。save/list/deleteの各ツールはprofile-manager.ts完成後に並列実装可能
- 検証: プロファイル保存 -> 再訪問で自動ロードされることを確認

### 単位9: バッチ実行とコンテンツツール（Phase 5）

- 対象ファイル:
  - `src/core/batch-executor.ts`
  - `src/tools/run-batch.ts`
  - `src/tools/read-table.ts`
  - `src/tools/screenshot.ts`
  - `src/tools/evaluate.ts`
- 変更内容:
  - `batch-executor.ts`:
    - `execute(s: Services, steps: BatchStep[]): Promise<BatchResult>`
    - 初期スナップショット取得 -> ステップ順次実行 -> チェックポイント記録（メモリ内） -> エラー時はキャプチャして返却 -> 最終スナップショットと初期のdiffを返す
  - `run-batch.ts`: `runBatch(s: Services, params: { steps: BatchStep[] }): Promise<string>`
  - `read-table.ts`:
    - `readTable(s: Services, params: { zone?: string; selector?: string }): Promise<string>`
    - テーブル要素を特定 -> thead/tbody を解析 -> JSON配列（行オブジェクト）で返す
  - `screenshot.ts`:
    - `takeScreenshot(s: Services, params: { zone?: string; full_page?: boolean }): Promise<ToolResult>`
    - zone指定あり: ゾーンのboundingBoxでクリップ -> Base64画像をimageコンテンツで返す
  - `evaluate.ts`: `evaluate(s: Services, params: { script: string }): Promise<string>`
- 並列可否: 単位8完了後に実施。batch-executor.tsは他の前提のため先行。read-table/screenshot/evaluateは並列実装可能
- 検証: バッチ実行のハッピーパス + エラーパス（失敗ステップの状態返却）を確認

### 単位10: 統合・設定（Phase 6）

- 対象ファイル:
  - `~/.mcp.json` （既存ファイルに追記）
  - `src/server.ts` （instructionsの記述）
  - `README.md`
- 変更内容:
  - `.mcp.json` に以下を追加:
    ```json
    "smallright": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/smallright/dist/index.js"]
    }
    ```
  - `server.ts` の McpServer に `instructions` を記述:
    - 基本操作フロー（navigate -> read_page -> click/fill）
    - ref IDはAIが指定しないこと
    - 曖昧マッチ時のindexによる解消方法
    - setup_page/save_profile の推奨タイミング
  - `README.md`: セットアップ手順、ツール一覧、使用例
- 並列可否: 単位9完了後に実施
- 検証: freeeログインフロー等をsmallrightで実行し、従来のPlaywright MCPと比較してトークン消費量が削減されることを確認

---

## 実装単位の依存関係と並列実施可能性

```
単位1（基盤）
    |
    +-- 単位2（browser-manager, element-registry）  --+
    +-- 単位3（state-builder）                        |  <- 並列可能
    |                                                 |
    +------------ 単位4（index.ts, server.ts）<- 単位2・3完了後
                      |
                  単位5（navigate, read-page, get-state）<- 並列可能
                      |
                  単位6（state-differ -> click/fill/fill-form/select-option）
                      |    state-differ先行、各ツールは並列可能
                  単位7（zone-manager -> setup-page, define-zones）
                      |    zone-manager先行、各ツールは並列可能
                  単位8（profile-manager -> save/list/delete + navigate更新）
                      |    profile-manager先行、各ツールは並列可能
                  単位9（batch-executor -> run-batch/read-table/screenshot/evaluate）
                      |    batch-executor先行、各ツールは並列可能
                  単位10（統合・設定）
```

---

## 設定・環境変数

| 変数名 | デフォルト | 説明 |
|---|---|---|
| `SMALLRIGHT_HEADLESS` | `true` | `false` にすると headed モードで起動 |

---

## リスク・注意点

1. **BrowserManagerのシングルトン管理**: Playwright の Browser/Page は同時複数ページを管理する場合の考慮が必要。Phase 1では1タブのみ対応とし、マルチタブは将来拡張とする。

2. **ゾーンなしでのstate-differ**: Phase 2でゾーンシステムがない状態でも StateDiff が機能する必要がある。ゾーン未設定時はページ全体を1ゾーンとして扱うフォールバックを単位6で実装する。

3. **element-registryのスキャンコスト**: 毎アクション後に全要素を再スキャンするとコストが高い可能性がある。Phase 1・2では都度スキャンとし、パフォーマンス問題が出た場合にキャッシュ戦略を検討する。

4. **曖昧マッチのAI体験**: AmbiguousMatch を返した後、AIが index を指定して再呼び出しする必要がある。ツールの `description` に挙動を明記すること。

5. **プロファイルのドメイン正規化**: `freee.co.jp` と `app.freee.co.jp` を同一視するかの判断が必要。初期実装ではURLのhostname（サブドメインを含む）をそのまま使い、後から調整する。

6. **Playwright headlessでのcaptcha**: headlessブラウザはcaptchaにひっかかる場合がある。その際はユーザーが `SMALLRIGHT_HEADLESS=false` で手動対応する想定とし、設計の対象外とする。

