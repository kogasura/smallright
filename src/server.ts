import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createBrowserManager } from "./core/browser-manager.js";
import { createElementRegistry } from "./core/element-registry.js";
import { createStateBuilder } from "./core/state-builder.js";
import { createStateDiffer } from "./core/state-differ.js";
import { createZoneManager } from "./core/zone-manager.js";
import { createProfileManager } from "./core/profile-manager.js";
import { createBatchExecutor } from "./core/batch-executor.js";
import { navigate } from "./tools/navigate.js";
import { readPage } from "./tools/read-page.js";
import { getState } from "./tools/get-state.js";
import { clickElement } from "./tools/click.js";
import { fillField } from "./tools/fill.js";
import { fillForm } from "./tools/fill-form.js";
import { selectOption } from "./tools/select-option.js";
import { setupPage } from "./tools/setup-page.js";
import { defineZones } from "./tools/define-zones.js";
import { saveProfile } from "./tools/save-profile.js";
import { listProfiles } from "./tools/list-profiles.js";
import { deleteProfile } from "./tools/delete-profile.js";
import { runBatch } from "./tools/run-batch.js";
import { readTable } from "./tools/read-table.js";
import { takeScreenshot } from "./tools/screenshot.js";
import { evaluate } from "./tools/evaluate.js";
import type { Services } from "./types.js";

export function createMcpServer(): { server: McpServer; services: Services } {
  const server = new McpServer(
    {
      name: "smallright",
      version: "0.1.0",
    },
    {
      instructions: `smallright — AI-Friendly Browser Automation

## 基本フロー
1. navigate(url) でページを開く → ActionModeState が返る
2. read_page() でコンテンツと操作可能な要素を確認
3. click(text) / fill(label, value) / fill_form(fields) で操作

## 要素の指定方法
- テキストで指定: click(text: "ログイン")
- ラベルで指定: fill(label: "メールアドレス", value: "test@example.com")
- ref IDやCSSセレクタは不要。テキスト/ラベルで指定すること

## 曖昧マッチ時
同名の要素が複数ある場合、候補リストが返される。index パラメータで指定して再実行すること。

## ゾーン（省トークン機能）
- setup_page() でページのゾーン（header/main/sidebar等）を自動検出
- read_page(zone: "main") で特定ゾーンだけ取得可能
- save_profile() でゾーン定義を保存、次回訪問時に自動適用

## バッチ実行
run_batch(steps) で複数操作を1回で実行可能。`,
    }
  );

  const services: Services = {
    browser: createBrowserManager(),
    elements: createElementRegistry(),
    state: createStateBuilder(),
    zones: createZoneManager(),
    differ: createStateDiffer(),
    profiles: createProfileManager(),
    batch: createBatchExecutor(),
  };

  // 共通のエラーハンドリングラッパー（freee-mcp-soloと同一パターン）
  function wrap(fn: () => Promise<string>) {
    return fn()
      .then((text) => ({
        content: [{ type: "text" as const, text }],
      }))
      .catch((err: unknown) => ({
        content: [
          {
            type: "text" as const,
            text: `エラー: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true as const,
      }));
  }

  // ── navigate ──
  server.tool(
    "navigate",
    "指定URLに遷移し、操作可能要素の一覧を返す。最初のアクションとして使用する。",
    {
      url: z.string().describe("遷移先のURL（例: https://example.com）"),
    },
    (params) => wrap(() => navigate(services, params))
  );

  // ── read_page ──
  server.tool(
    "read_page",
    "現在のページの操作可能要素とコンテンツを取得する。navigate後や操作後に状態を確認するために使用する。zone指定でゾーン絞込が可能（Phase 3以降）。",
    {
      zone: z
        .string()
        .optional()
        .describe(
          "取得対象のゾーン名（例: main, header）。省略時はページ全体を対象とする"
        ),
    },
    (params) => wrap(() => readPage(services, params))
  );

  // ── get_state ──
  server.tool(
    "get_state",
    "現在のページの生の状態を取得するフォールバックツール。mode: action は操作可能要素リスト、mode: visual はフルDOM。通常は navigate / read_page を使うこと。",
    {
      mode: z
        .enum(["action", "visual"])
        .describe(
          "action: 操作可能要素リスト（トークン節約）、visual: フルDOM（詳細確認用）"
        ),
    },
    (params) => wrap(() => getState(services, params))
  );

  // ── click ──
  server.tool(
    "click",
    "テキストで要素を指定してクリックする。操作後の変更ゾーンを StateDiff で返す。複数要素がマッチした場合は AmbiguousMatch を返すので、candidates を確認して index を指定して再呼び出しすること。",
    {
      text: z.string().describe("クリックする要素のテキスト（ボタンラベル、リンクテキスト等）"),
      role: z.string().optional().describe("要素のロール（例: button, link）。指定するとマッチ精度が上がる"),
      zone: z.string().optional().describe("検索対象ゾーン名。省略時は全ゾーンを対象とする"),
      index: z.number().optional().describe("AmbiguousMatch 時に候補を指定するインデックス（0始まり）"),
    },
    (params) => wrap(() => clickElement(services, params))
  );

  // ── fill ──
  server.tool(
    "fill",
    "ラベルでフィールドを指定して値を入力する。操作後の変更ゾーンを StateDiff で返す。複数フィールドがマッチした場合は AmbiguousMatch を返す。",
    {
      label: z.string().describe("入力フィールドのラベルテキスト（<label>、aria-label、placeholder等）"),
      value: z.string().describe("入力する値"),
    },
    (params) => wrap(() => fillField(services, params))
  );

  // ── fill_form ──
  server.tool(
    "fill_form",
    "フォームの複数フィールドをラベルと値のマップで一括入力する。操作後の変更ゾーンを StateDiff で返す。途中でマッチ失敗した場合は入力済みフィールドとエラー情報を返す。",
    {
      fields: z.record(z.string(), z.string()).describe("ラベル→値のマップ（例: { \"メールアドレス\": \"user@example.com\", \"パスワード\": \"password\" }）"),
    },
    (params) => wrap(() => fillForm(services, params))
  );

  // ── select_option ──
  server.tool(
    "select_option",
    "ラベルでドロップダウンを指定してオプションを選択する。操作後の変更ゾーンを StateDiff で返す。",
    {
      label: z.string().describe("セレクトフィールドのラベルテキスト"),
      value: z.string().describe("選択するオプションの value 属性または表示テキスト"),
    },
    (params) => wrap(() => selectOption(services, params))
  );

  // ── setup_page ──
  server.tool(
    "setup_page",
    "現在のページのゾーンを自動検出し、ZoneDefinition[] を返す。初回訪問時や save_profile の前に実行する。検出結果を確認・修正してから define_zones で確定するか、そのまま save_profile で保存する。",
    {},
    (_params) => wrap(() => setupPage(services, _params as Record<string, never>))
  );

  // ── define_zones ──
  server.tool(
    "define_zones",
    "ゾーン定義を手動で指定して現在のセッションに適用する。setup_page の結果を修正したい場合や、サイト固有のゾーンを明示的に設定したい場合に使用する。",
    {
      zones: z.array(
        z.object({
          name: z.string().describe("ゾーン名（例: header, main, sidebar, footer）"),
          selector: z.string().describe("CSSセレクタ（例: #main, .content, main）"),
          description: z.string().optional().describe("ゾーンの説明（任意）"),
        })
      ).describe("ゾーン定義の配列"),
    },
    (params) => wrap(() => defineZones(services, params))
  );

  // ── save_profile ──
  server.tool(
    "save_profile",
    "現在のゾーン定義をドメインにひもづけてファイルに保存する。setup_page / define_zones でゾーンを確定した後に実行する。次回 navigate 時に自動ロードされる。",
    {
      domain: z.string().optional().describe("保存先ドメイン（例: example.com）。省略時は現在のページのhostnameを使用する"),
    },
    (params) => wrap(() => saveProfile(services, params))
  );

  // ── list_profiles ──
  server.tool(
    "list_profiles",
    "保存済みのサイトプロファイル一覧を返す。",
    {},
    (_params) => wrap(() => listProfiles(services, _params as Record<string, never>))
  );

  // ── delete_profile ──
  server.tool(
    "delete_profile",
    "指定ドメインのサイトプロファイルを削除する。",
    {
      domain: z.string().describe("削除対象のドメイン（例: example.com）"),
    },
    (params) => wrap(() => deleteProfile(services, params))
  );

  // ── run_batch ──
  server.tool(
    "run_batch",
    "複数の操作ステップを一括実行し、最終状態のStateDiffを返す。MCPのラウンドトリップを削減するために使用する。エラー発生時はそのステップのインデックスと状態を返す。曖昧マッチが発生した場合もエラーとして停止する。",
    {
      steps: z.array(
        z.object({
          action: z
            .enum(["click", "fill", "fill_form", "select", "navigate", "wait"])
            .describe("実行するアクションの種類"),
          text: z.string().optional().describe("click: クリックする要素のテキスト"),
          label: z
            .string()
            .optional()
            .describe("fill / select: フィールドのラベルテキスト"),
          value: z
            .string()
            .optional()
            .describe("fill / select: 入力する値またはオプション"),
          fields: z
            .record(z.string(), z.string())
            .optional()
            .describe("fill_form: ラベル→値のマップ"),
          url: z.string().optional().describe("navigate: 遷移先URL"),
          ms: z
            .number()
            .optional()
            .describe("wait: 待機ミリ秒（省略時1000ms）"),
        })
      ).describe("実行するステップの配列"),
    },
    (params) => wrap(() => runBatch(services, params))
  );

  // ── read_table ──
  server.tool(
    "read_table",
    "ページ内のテーブルをJSON配列で返す。zone または selector でテーブルを絞り込める。どちらも省略するとページ内の最初のテーブルを対象とする。",
    {
      zone: z
        .string()
        .optional()
        .describe("テーブルを含むゾーン名。ゾーン内の最初のテーブルを対象とする"),
      selector: z
        .string()
        .optional()
        .describe("テーブルを直接指定するCSSセレクタ（例: #data-table, .results table）"),
    },
    (params) => wrap(() => readTable(services, params))
  );

  // ── screenshot ──
  server.tool(
    "screenshot",
    "現在のページまたは指定ゾーンのスクリーンショットを取得する。Base64エンコードされた画像をJSONで返す。",
    {
      zone: z
        .string()
        .optional()
        .describe("キャプチャ対象のゾーン名。省略時はページ全体を対象とする"),
      full_page: z
        .boolean()
        .optional()
        .describe("true にするとスクロール全体をキャプチャする（zone未指定時のみ有効）"),
    },
    (params) => wrap(() => takeScreenshot(services, params))
  );

  // ── evaluate ──
  server.tool(
    "evaluate",
    "ブラウザ上でカスタムJavaScriptを実行し、その戻り値をJSONで返す。フォールバック用の低レベルツール。通常は他のツールを使うこと。",
    {
      script: z
        .string()
        .describe(
          "実行するJavaScript（関数本体。例: \"return document.title\" ）"
        ),
    },
    (params) => wrap(() => evaluate(services, params))
  );

  return { server, services };
}
