import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { dirFromMetaUrl } from "./paths.js";

const FIXTURES_DIR = path.resolve(dirFromMetaUrl(import.meta.url), "..", "fixtures");

/**
 * 計測対象サイトの種別。
 *
 * - local:  リポジトリ同梱の固定 HTML (file://)。再現性がある
 * - remote: 実在の公開サイト。実環境に近いが仕様変更・障害で結果が変わる
 */
export type TargetKind = "local" | "remote";

export interface TargetUrls {
  /** EC サイトのトップ（ログイン画面） */
  shop: string;
  /** テーブル表示ページ */
  tables: string;
}

function fileUrl(...segments: string[]): string {
  return pathToFileURL(path.join(FIXTURES_DIR, ...segments)).href;
}

export function targetUrls(kind: TargetKind): TargetUrls {
  if (kind === "local") {
    return {
      shop: fileUrl("shop", "index.html"),
      tables: fileUrl("tables.html"),
    };
  }
  return {
    shop: "https://www.saucedemo.com",
    tables: "https://the-internet.herokuapp.com/tables",
  };
}

export interface Scenario {
  id: string;
  name: string;
  /** 計測対象の URL を受け取ってプロンプトを組み立てる */
  buildPrompt: (urls: TargetUrls) => string;
  /** すべて含まれていれば成功（大文字小文字無視） */
  successIncludes: string[];
  /**
   * 1 つでも含まれていたら失敗とみなす文字列。
   * 「聞かれていないことまで羅列している」= ページ全文を吐いただけ、を弾くために使う。
   */
  successExcludes: string[];
  /**
   * レスポンス長の上限（文字数）。
   * これを超えたらタスクに答えたのではなくページを丸写ししたとみなす。
   */
  maxResultChars: number;
}

export const scenarios: Scenario[] = [
  {
    id: "login",
    name: "ログイン & 商品名取得",
    buildPrompt: (u) =>
      `利用可能なブラウザツールを使って、${u.shop} を開いてください。` +
      "ユーザー名 standard_user、パスワード secret_sauce でログインし、" +
      "ログイン後の最初の商品名だけを答えてください。他の商品名は挙げないでください。",
    successIncludes: ["Sauce Labs Backpack"],
    // 最初の 1 件だけを聞いているので、2 件目以降の商品名が出てきたら
    // 「一覧を丸ごと吐いた」とみなして失敗にする
    successExcludes: ["Sauce Labs Bike Light", "Sauce Labs Onesie"],
    maxResultChars: 600,
  },
  {
    id: "table",
    name: "テーブル読取",
    buildPrompt: (u) =>
      `利用可能なブラウザツールを使って、${u.tables} を開いてください。` +
      "ページ内の1つ目のテーブルについて、各行の Last Name と Email を一覧で答えてください。" +
      "Due や Web Site などの他の列は含めないでください。",
    successIncludes: ["Smith", "jsmith@gmail.com", "Conway", "tconway@earthlink.net"],
    // 聞いていない列が混ざっていたらページの丸写しとみなす
    successExcludes: ["http://www.jsmith.com", "$50.00"],
    maxResultChars: 1200,
  },
  {
    id: "checkout",
    name: "複数ステップ: カート→チェックアウト情報入力",
    buildPrompt: (u) =>
      `利用可能なブラウザツールを使って、${u.shop} を開いてください。` +
      "ユーザー名 standard_user、パスワード secret_sauce でログインし、" +
      "いずれかの商品をカートに追加してカート画面に移動し、さらにチェックアウト情報入力画面まで進んでください。" +
      "その画面に表示されている入力項目名だけをすべて答えてください。",
    successIncludes: ["First Name", "Last Name", "Zip"],
    // 商品一覧やカート内容まで書いていたら、道中のページを丸写ししたとみなす
    successExcludes: ["Sauce Labs Bike Light", "Continue Shopping"],
    maxResultChars: 800,
  },
];

export interface JudgeResult {
  success: boolean;
  /** 失敗した理由。成功時は null */
  reason: string | null;
}

/**
 * レスポンステキストがシナリオを達成しているかを判定する。
 *
 * 部分一致だけで判定すると、ページ全文を出力するだけで通ってしまい、
 * より多くのコンテキストを読む戦略が有利になってしまう。
 * 「必要な情報が含まれる」に加えて「余計な情報が含まれない」「長すぎない」を課す。
 */
export function judgeScenario(result: string, scenario: Scenario): JudgeResult {
  if (result.length > scenario.maxResultChars) {
    return {
      success: false,
      reason: `レスポンスが長すぎる (${result.length} > ${scenario.maxResultChars} 文字)`,
    };
  }

  const lower = result.toLowerCase();

  for (const s of scenario.successIncludes) {
    if (!lower.includes(s.toLowerCase())) {
      return { success: false, reason: `期待する文字列が含まれない: ${s}` };
    }
  }

  for (const s of scenario.successExcludes) {
    if (lower.includes(s.toLowerCase())) {
      return { success: false, reason: `聞いていない情報が含まれる: ${s}` };
    }
  }

  return { success: true, reason: null };
}

/**
 * result テキストに successIncludes の文字列が（大文字小文字を無視して）
 * すべて含まれる場合に true を返す。
 *
 * @deprecated judgeScenario を使うこと。除外条件・長さ制限を見ないため、
 * ページ全文を出力しただけのレスポンスを弾けない。
 */
export function judge(result: string, successIncludes: string[]): boolean {
  if (successIncludes.length === 0) return true;
  const lower = result.toLowerCase();
  return successIncludes.every((s) => lower.includes(s.toLowerCase()));
}
