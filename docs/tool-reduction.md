# 設計書: ツール削減・統合 (23本 -> 17本)

## 概要

smallright MCP サーバーのツール数を 23 本から 17 本に削減する。
目的は AI が選択すべきツールの認知負荷を下げること、および似た機能の重複を排除すること。

削減方法は 3 種類:
- 削除: 上位互換ツールが存在するため不要
- 統合: 既存ツールへのパラメータ追加で吸収
- 新規作成: 2 本を 1 本に置き換える新ツール

## 技術スタック

- TypeScript (既存)
- Zod (スキーマバリデーション, 既存)
- Playwright (ブラウザ操作, 既存)

## 変更一覧

### 削除するファイル (7本)

| ファイル | 理由 |
|---|---|
| src/tools/fill.ts | fill_form が上位互換 (re-scan・ソフトエラー対応済み) |
| src/tools/get-state.ts | read_page に mode: "visual" を追加して代替 |
| src/tools/list-profiles.ts | navigate がプロファイル自動ロードするため不要 |
| src/tools/hover.ts | click に action: "hover" を追加して統合 |
| src/tools/navigate-back.ts | navigate に back: true を追加して統合 |
| src/tools/setup-page.ts | configure_zones (新規) に統合 |
| src/tools/define-zones.ts | configure_zones (新規) に統合 |

### 変更するファイル

| ファイル | 変更内容 |
|---|---|
| src/tools/click.ts | action?: "click" or "hover" パラメータ追加 |
| src/tools/navigate.ts | back?: boolean パラメータ追加、url を optional に変更 |
| src/tools/read-page.ts | mode?: "action" or "visual" パラメータ追加 |
| src/tools/fill-form.ts | description 更新のみ (実装変更なし) |
| src/core/batch-executor.ts | "fill" アクション削除、"hover" アクション追加 |
| src/types.ts | BatchStep.action の enum を更新 |
| src/server.ts | インポート整理・スキーマ更新・instructions 更新 |

### 新規作成するファイル

| ファイル | 内容 |
|---|---|
| src/tools/configure-zones.ts | setup_page + define_zones を統合した新ツール |

---

## 実装単位

各単位は対象ファイルが重複しないため、単位7を除いてすべて並列実装可能。
単位7 (server.ts) は単位1〜6 が完了してから着手すること
(削除済みファイルのインポートが残るとコンパイルエラーになる)。

---

### 単位1: fill 削除

- 対象ファイル:
  - src/tools/fill.ts — 削除
- 変更内容:
  - ファイルを削除するのみ。server.ts の対応は単位7で行う。
- 並列可否: 並列可

---

### 単位2: get_state 削除 + read_page に visual モード追加

- 対象ファイル:
  - src/tools/get-state.ts — 削除
  - src/tools/read-page.ts — 変更
- 変更内容 (read-page.ts):
  - params に mode?: "action" | "visual" を追加
  - 関数冒頭 (既存の zone 分岐より前) に以下の分岐を追加:
    ```
    if (params.mode === "visual") {
      // visual は即時 DOM 取得が目的のため waitForSpaReady は呼ばない
      // (get_state の既存実装に合わせた動作)
      const state = await s.state.buildVisualModeState(page);
      return JSON.stringify(state, null, 2);
    }
    ```
  - mode 省略または "action" の場合は既存ロジックをそのまま実行 (変更なし)
- get_state action モードの代替について:
  - get_state(mode: "action") は read_page(zone 省略) で代替される
  - zone 定義済みでフルページが必要な場合も read_page(zone 省略) を使う (既存の zone 省略動作と同等)
  - 追加実装は不要。この方針を server.ts の instructions に明記すること
- 並列可否: 並列可

---

### 単位3: list_profiles 削除

- 対象ファイル:
  - src/tools/list-profiles.ts — 削除
- 変更内容:
  - ファイルを削除するのみ。server.ts の対応は単位7で行う。
- 削除の根拠:
  - navigate がドメインベースでプロファイルを自動ロードするため、AI が能動的にプロファイル一覧を確認する必要がない
  - プロファイル管理が必要な場合は delete_profile でドメイン指定削除が可能
  - デバッグ用途は evaluate でファイルシステムを直接読むか、ユーザーが手動確認する
- 並列可否: 並列可

---

### 単位4: hover → click 統合

- 対象ファイル:
  - src/tools/hover.ts — 削除
  - src/tools/click.ts — 変更
- 変更内容 (click.ts):
  - params に action?: "click" | "hover" を追加
  - locator.click() 呼び出し箇所を以下の分岐に置き換え:
    ```
    if (params.action === "hover") {
      // hover パス: waitForURL の2秒待ちをスキップ
      await locator.hover({ timeout: 10000 });
    } else {
      // click パス (デフォルト)
      await locator.click({ timeout: 10000 });
      try {
        await page.waitForURL((url) => url.toString() !== urlBefore, { timeout: 2000 });
      } catch {
        // No navigation occurred
      }
    }
    ```
  - waitForTimeout(300) 以降の共通処理 (re-scan・diff 計算・返却) は変更なし
- 並列可否: 並列可

---

### 単位5: navigate_back → navigate 統合

- 対象ファイル:
  - src/tools/navigate-back.ts — 削除
  - src/tools/navigate.ts — 変更
- 変更内容 (navigate.ts):
  - シグネチャを params: { url?: string; back?: boolean } に変更
  - 関数冒頭にバリデーションを追加:
    ```
    if (params.back && params.url) {
      throw new Error("Cannot specify both url and back: true");
    }
    if (!params.back && !params.url) {
      throw new Error("Either url or back: true must be specified");
    }
    ```
  - params.back === true の場合は navigate-back.ts の実装をそのまま移植:
    - page.goBack({ waitUntil: "domcontentloaded", timeout: 30000 })
    - response が null なら Error をスロー
    - goBack 完了後、現在の URL からドメインを取得する
    - 取得したドメインが現在のゾーン設定のドメインと異なる場合はプロファイル再ロードを行う
    - 同一ドメインの場合は既存のゾーン設定を維持する
    - waitForSpaReady -> scan -> buildActionModeState -> dialogs チェック -> return
  - params.url の場合は既存実装をそのまま実行 (変更なし)
- 並列可否: 並列可

---

### 単位6: setup_page + define_zones → configure_zones 新規作成

- 対象ファイル:
  - src/tools/setup-page.ts — 削除
  - src/tools/define-zones.ts — 削除
  - src/tools/configure-zones.ts — 新規作成
- 変更内容 (configure-zones.ts の実装要件):
  - params: { zones?: Array<{ name: string; selector: string; description?: string }> }
  - zones 省略時 (auto モード):
    - s.zones.autoDetect(page) を呼ぶ
    - 結果を s.zones.setZones(detected) でセット
    - 設定後のゾーン定義 (ZoneDefinition[]) を直接返す (setup_page と同じ形式)
  - zones 指定時 (manual モード):
    - ZoneDefinition[] に変換して s.zones.setZones(zones) でセット
    - 設定後のゾーン定義 (ZoneDefinition[]) を直接返す (確認用)
  - 戻り値は JSON.stringify して返す
- 注意: 旧設計では { mode, zones, message } 形式を返す案があったが、シンプルにするため
  ZoneDefinition[] の直返しに変更した。save_profile に連携する際はそのまま渡せる。
- 並列可否: 並列可

---

### 単位7: server.ts の整合

- 対象ファイル:
  - src/server.ts — 変更
- 依存関係: 単位1〜6 がすべて完了してから着手すること
- 変更内容:

  削除するインポート (7件):
  - fillField from ./tools/fill.js
  - getState from ./tools/get-state.js
  - listProfiles from ./tools/list-profiles.js
  - hoverElement from ./tools/hover.js
  - navigateBack from ./tools/navigate-back.js
  - setupPage from ./tools/setup-page.js
  - defineZones from ./tools/define-zones.js

  追加するインポート (1件):
  - configureZones from ./tools/configure-zones.js

  削除するツール登録ブロック (7件):
  - fill ツール (server.ts L153〜L162)
  - get_state ツール (server.ts L125〜L138)
  - list_profiles ツール (server.ts L218〜L225)
  - hover ツール (server.ts L395〜L407)
  - navigate_back ツール (server.ts L365〜L372)
  - setup_page ツール (server.ts L185〜L191)
  - define_zones ツール (server.ts L193〜L208)

  変更するツール登録 (4件):

  1. navigate スキーマ変更:
     - url: z.string().optional() に変更
     - back: z.boolean().optional().describe("Set to true to go back in browser history. Cannot be used with url.") を追加

  2. click スキーマへの追加:
     - action: z.enum(["click", "hover"]).optional().describe(...) を追加
     - description 更新: hover 時は waitForURL をスキップする旨を追記

  3. read_page スキーマへの追加:
     - mode: z.enum(["action", "visual"]).optional().describe(...) を追加
     - description 更新: mode の使い方を追記

  4. fill_form description 更新:
     - "Fill multiple form fields at once using a label-to-value map.
       Use this for both single-field and multi-field cases.
       Returns a StateDiff after all fields are filled.
       If a field cannot be matched, returns the filled fields so far along with error details."

  追加するツール登録 (1件):
  configure_zones を setup_page があった位置付近に追加:
  ```
  server.tool(
    "configure_zones",
    "Configure zones for the current page. Omit zones to auto-detect. Supply zones to manually define them. Returns ZoneDefinition[] directly. Pass the result to save_profile when saving.",
    {
      zones: z.array(z.object({
        name: z.string(),
        selector: z.string(),
        description: z.string().optional(),
      })).optional().describe("Zone definitions. Omit for auto-detection."),
    },
    (params) => wrap(() => configureZones(services, params))
  );
  ```

  run_batch の action enum 更新:
  - z.enum(["click", "hover", "fill_form", "select", "navigate", "wait"])
  - ("fill" を削除、"hover" を追加)

  instructions の更新:
  - Basic Flow の fill(label, value) を削除し fill_form(fields) のみに
  - setup_page() の記述を configure_zones() に変更
  - navigate(url) の補足に back: true の使い方を追加
  - hover の記述を click(text, action: "hover") に変更
  - define_zones の記述を削除
  - configure_zones が ZoneDefinition[] を直返しすること、save_profile にそのまま渡せることを追記
  - get_state(mode: "action") は read_page(zone 省略) で代替される旨を追記

- 並列可否: 単位1〜6 完了後に着手 (直列)

---

### 単位8: types.ts の BatchStep enum 更新

- 対象ファイル:
  - src/types.ts — 変更
- 変更内容:
  BatchStep.action の型を変更:
  ```
  // 変更前
  action: "click" | "fill" | "fill_form" | "select" | "navigate" | "wait";
  // 変更後
  action: "click" | "hover" | "fill_form" | "select" | "navigate" | "wait";
  ```
  ("fill" を削除し "hover" を追加)
- 並列可否: 並列可 (server.ts・batch-executor.ts とは独立して変更可能)

---

### 単位9: batch-executor.ts の "fill" 削除 + "hover" 追加

- 対象ファイル:
  - src/core/batch-executor.ts — 変更
- 変更内容:
  1. step.action === 'fill' のブロック (L79〜L129) を削除
  2. step.action === 'hover' のブロックを追加 (click ブロックの直後):
     - elements を scan して resolveByText
     - null の場合: click ブロックと同一のエラーハンドリング
     - AmbiguousMatch の場合: click ブロックと同一のエラーハンドリング
     - locator.hover({ timeout: 10000 }) を呼ぶ
     - waitForURL はスキップ (hover は画面遷移を起こさない前提)
     - 以降の waitForTimeout(500) と stepsCompleted++ は共通処理で通る
- 並列可否: 並列可

---

## ツール数の整理結果

元の 23 本からの変化:
- 削除: fill, get_state, list_profiles, hover, navigate_back, setup_page, define_zones = 7本
- 追加: configure_zones = 1本
- 結果: 23 - 7 + 1 = 17本

最終 17 本の一覧:
1. navigate (back: true パラメータ追加)
2. read_page (mode: "action" | "visual" パラメータ追加)
3. click (action: "click" | "hover" パラメータ追加)
4. fill_form (description のみ更新)
5. select_option
6. save_profile
7. delete_profile
8. run_batch (enum 更新)
9. read_table
10. screenshot
11. upload_file
12. download_file
13. evaluate
14. set_viewport
15. press_key
16. wait_for
17. configure_zones (新規)

---

## リスク・注意点

1. BatchStep の "fill" 廃止は破壊的変更:
   既存の run_batch 利用者が action: "fill" を使っていた場合、"fill_form" への修正が必要。
   リリースノートに必ず記載すること。

2. navigate の url オプション化:
   現在 url は必須パラメータ。optional() に変更すると Zod の型推論が変わる。
   navigate 関数側に「url も back も未指定」のランタイムバリデーションを必ず追加すること (単位5参照)。

3. configure_zones の戻り値フォーマット:
   setup_page と同じ ZoneDefinition[] を直接返す形式を採用した。
   { mode, zones, message } 形式は採用しない。
   save_profile に連携する際はそのまま渡せる。

4. 単位7 の server.ts は最後に着手:
   削除したファイルのインポートが残ったままビルドするとコンパイルエラーになる。
   単位1〜6 を完了させてから単位7 を実施すること。

5. fill_form の description 更新:
   既存の fill ツールに慣れた AI が fill_form を「複数フィールド専用」と誤解しないよう、
   「1フィールドの場合も fill_form を使うこと」を description に明記すること。
