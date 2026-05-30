export interface Scenario {
  id: string;
  name: string;
  prompt: string;
  successIncludes: string[];
}

export const scenarios: Scenario[] = [
  {
    id: "login",
    name: "ログイン & 商品名取得",
    prompt:
      "利用可能なブラウザツールを使って、https://www.saucedemo.com を開いてください。" +
      "ユーザー名 standard_user、パスワード secret_sauce でログインし、" +
      "ログイン後の最初の商品名を答えてください。",
    successIncludes: ["Sauce Labs Backpack"],
  },
  {
    id: "table",
    name: "テーブル読取",
    prompt:
      "利用可能なブラウザツールを使って、https://the-internet.herokuapp.com/tables を開いてください。" +
      "ページ内の1つ目のテーブルについて、各行の Last Name と Email を一覧で答えてください。",
    successIncludes: ["Smith", "jsmith@gmail.com"],
  },
  {
    id: "checkout",
    name: "複数ステップ: カート→チェックアウト情報入力",
    prompt:
      "利用可能なブラウザツールを使って、https://www.saucedemo.com を開いてください。" +
      "ユーザー名 standard_user、パスワード secret_sauce でログインし、" +
      "いずれかの商品をカートに追加してカート画面に移動し、さらにチェックアウト情報入力画面まで進んでください。" +
      "その画面に表示されている入力項目名をすべて答えてください。",
    successIncludes: ["First Name", "Last Name", "Zip"],
  },
];

/**
 * result テキストに successIncludes の文字列が（大文字小文字を無視して）
 * すべて含まれる場合に true を返す。
 */
export function judge(result: string, successIncludes: string[]): boolean {
  if (successIncludes.length === 0) return true;
  const lower = result.toLowerCase();
  return successIncludes.every((s) => lower.includes(s.toLowerCase()));
}
