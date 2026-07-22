# smallright Token Benchmark

smallright と公式 @playwright/mcp の**消費トークン数を実エージェントで比較**するベンチマークハーネスです。

## 何を測るか

Claude (Sonnet) に**同一のブラウザ操作タスク**を与え、使用する MCP だけを切り替えて比較します。

- **smallright**: ゾーンベースの部分 DOM 取得により、LLM に渡すコンテキストを削減
- **@playwright/mcp**: 公式実装（フルページ情報を渡す）

双方の `--output-format json` の `usage` フィールドから実トークン数を取得し、中央値・削減率などを集計します。

## 測定手法

| 項目 | 内容 |
|------|------|
| エージェント | Claude Sonnet (claude -p / ヘッドレス) |
| 測定値 | usage.input_tokens / output_tokens / cache_{creation,read}_input_tokens の合計 |
| 差分 | 使用する MCP のみ。プロンプト・モデル・シナリオはすべて同一 |
| ツール制限 | --allowedTools でブラウザ MCP ツールのみ許可 |
| 成功判定 | レスポンステキストに期待文字列が含まれるか（大文字小文字無視・全包含） |
| 実行順序 | repeat ごとに MCP を交互実行し、1 回おきに順序を反転（先行/後行の偏りを排除） |
| タイムアウト | 1 run あたり 5 分。超過時は子プロセスを強制終了し is_error として扱う |

## $0 で回す手順（サブスクリプション認証）

**ANTHROPIC_API_KEY は設定しないでください。** このハーネスは Claude Max/Pro サブスクリプションを前提とし、API キーが設定されていると従量課金が発生します。

子プロセス起動時に `ANTHROPIC_API_KEY` を env から除外するよう実装してあります。

`--bare` フラグは使用しません。`--bare` は usage を出力しないため、トークン数が取得できないからです。

```bash
# サブスク認証を確認（Claude CLI がログイン済みであること）
claude --version

# smallright 本体をビルドする（必須）
# ベンチマークは <repoRoot>/dist/index.js を MCP サーバーとして起動する。
# dist/ は .gitignore 対象なので、クローン直後はこのビルドが必要。
# 省略すると smallright 側の run がすべて ERROR になる。
npm ci
npm run build

# 依存インストール
cd benchmarks
npm install

# 実行（全シナリオ×両MCP×3回）
npm run bench

# オプション例
npm run bench -- --repeat 5
npm run bench -- --scenario login --mcp smallright
npm run bench -- --model claude-sonnet-4-5
```

## 対象サイト・固定バージョン

| 対象 | URL |
|------|-----|
| saucedemo | https://www.saucedemo.com |
| the-internet tables | https://the-internet.herokuapp.com/tables |

| ソフトウェア | バージョン |
|-------------|-----------|
| @playwright/mcp | **0.0.29** |

## シナリオ

| ID | 名前 | 期待値（一部） |
|----|------|--------------|
| login | ログイン & 商品名取得 | "Sauce Labs Backpack" |
| table | テーブル読取 | "Smith", "jsmith@gmail.com" |
| checkout | 複数ステップ: カート→チェックアウト情報入力 | "First Name", "Last Name", "Zip" |

## 結果の見方

`results/results.md` に表として出力されます。

- **Token Reduction**: `(playwright_median - smallright_median) / playwright_median * 100`。正の値が削減（smallright の方が少ない）。
- **completion_rate**: エラーなく期待文字列を含むレスポンスを返せた割合。

### 削減率が N/A になる条件

トークン中央値は成功 run のみから計算しています。片方の MCP だけ成功率が低い状態で
中央値同士を比較すると、母集団の違う数字を割ることになり比較が成立しません。

そのため **どちらかの MCP の成功 run が全 run の半数を下回る場合、削減率は N/A** とし、
理由をレポートに明記します。数字が出ないときは成功 run 数（Overall Summary に併記）を
確認してください。

## 公平性ノート

### 数えているもの
- `usage.input_tokens` (モデルへの入力)
- `usage.output_tokens` (モデルからの出力)
- `usage.cache_creation_input_tokens` (キャッシュ書き込み時のトークン)
- `usage.cache_read_input_tokens` (キャッシュ読み出し時のトークン)

### 数えていないもの
- MCP サーバー側の処理コスト（CPU / メモリ）
- ネットワーク遅延
- ブラウザ起動コスト

### 非決定性について
LLM は非決定的です。同一プロンプト・同一ページでも実行ごとにトークン数は変化します。
複数回 (--repeat) 実行し中央値で比較することで影響を軽減しています。

## 免責事項

- 対象サイト (saucedemo / the-internet) の仕様変更によりシナリオが失敗する場合があります。
- LLM の非決定性により、結果は実行ごとに変動します。
- このベンチマークは参考値です。ワークロードによって実際の削減率は異なります。
