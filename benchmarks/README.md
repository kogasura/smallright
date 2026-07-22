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
| 測定値 | usage.input_tokens / output_tokens / cache_{creation,read}_input_tokens（指標は下記参照） |
| 差分 | 使用する MCP のみ。プロンプト・モデル・シナリオはすべて同一 |
| ツール制限 | 組み込みツールを全て無効化し、ブラウザ MCP ツールのみ許可（下記参照） |
| 事前チェック | 実行前に MCP 接続を確認し、繋がっていなければ中止 |
| 成功判定 | 期待文字列を全て含み、かつ聞いていない情報を含まず、長さ上限内であること |
| 対象サイト | 既定は同梱フィクスチャ (file://)。`--target remote` で実サイト |
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
npm run bench -- --target remote
npm run bench -- --scenario login --mcp smallright
npm run bench -- --model claude-sonnet-4-5
```

### ブラウザが用意されていない環境（CI / サンドボックス）

@playwright/mcp は既定でシステムの Chrome チャンネル
(`/opt/google/chrome/chrome`) を起動しようとします。それが無く、Playwright の
バンドル chromium だけがある環境では、`PLAYWRIGHT_MCP_EXECUTABLE_PATH` に
ブラウザバイナリのパスを渡すと、playwright 側の MCP へ `--executable-path` を
注入して既存ブラウザを使わせます（smallright 側はバンドル chromium を自動使用）。

```bash
# 例: Playwright のバンドル chromium を指す
PLAYWRIGHT_MCP_EXECUTABLE_PATH=/opt/pw-browsers/chromium npm run bench
```

## 対象サイト

外部の公開サイトに依存すると、サイトの仕様変更・障害・ネットワーク遅延で結果が変わり、
過去の測定値と比較できません。そのため **既定はリポジトリ同梱の固定 HTML** です。

### local（既定）

`benchmarks/fixtures/` 配下の静的 HTML を、実行時に立てる軽量 HTTP サーバー
（`http://127.0.0.1:<ランダムポート>`）で配信して開きます。外部ネットワークには
一切依存しません。

> **なぜ file:// ではなく http か**
> smallright の `navigate` は http/https 以外のスキームを受け付けない
> （browser-manager が `Unsupported protocol` で弾く）ため、`file://` では
> 開けません。両 MCP を同一条件で開けるよう、ローカルフィクスチャも http で
> 配信します。ポートは OS に採番させるので既存プロセスと衝突しません。

| 対象 | ファイル | 内容 |
|------|---------|------|
| shop | `fixtures/shop/index.html` | ログイン → 商品一覧 → カート → チェックアウト情報入力 |
| tables | `fixtures/tables.html` | 2 つのデータテーブル |

ページ間の状態は URL のクエリ文字列で受け渡しています。

```bash
npm run bench                      # local（既定）
```

### remote

実在の公開サイトを対象にします。実環境に近い挙動を見たいときに使いますが、
結果の再現性はありません。

| 対象 | URL |
|------|-----|
| saucedemo | https://www.saucedemo.com |
| the-internet tables | https://the-internet.herokuapp.com/tables |

```bash
npm run bench -- --target remote
```

### 固定バージョン

@playwright/mcp のバージョンは `configs/playwright.mcp.json` の `args` で指定し、
レポートにはそこから読み取った値を出力します（現在: **0.0.78**）。

## シナリオ

| ID | 名前 | 期待値（一部） |
|----|------|--------------|
| login | ログイン & 商品名取得 | "Sauce Labs Backpack" |
| table | テーブル読取 | "Smith", "jsmith@gmail.com" |
| checkout | 複数ステップ: カート→チェックアウト情報入力 | "First Name", "Last Name", "Zip" |

## ツール制限と事前チェック

計測を成立させるための仕掛けが 2 つあります。どちらも**これが無いと、それらしい
数字が出てしまうが中身が別物**という失敗を防ぐためのものです。

### 組み込みツールの無効化

`--allowedTools` は許可リストを**追加するだけで、他のツールを禁止しません**。
`--dangerously-skip-permissions` と併用すると、エージェントは Read / Bash / Glob /
Grep / WebFetch を自由に使えます。

その状態では「ブラウザを操作するより HTML を直接読んだ方が早い」と判断され、
ブラウザ MCP を経由せずにタスクを達成できてしまいます。ローカルフィクスチャは
ディスク上のただのファイルなので特にそうなりやすい。こうなると測っているのは
ブラウザ MCP のトークン効率ではなくなり、両者の差が消えます。

そのため `--tools ""` で組み込みツールを全て落とし、MCP ツールだけを残します。
個別の禁止リストではなく一括無効化にしているのは、CLI に新しい組み込みツールが
追加されても抜け道が増えないようにするためです。

あわせて `--strict-mcp-config` を付け、ユーザーのグローバル設定にある MCP
サーバーが計測に混入しないようにしています。

### 事前チェック

MCP サーバーが起動していない場合、claude は**黙ってそのツールを持たないまま実行を
続けます**。気付かずに回すと、エージェントは別の手段でタスクを解こうとし、
計測値が意味を失います。

実行前に 1 回だけ「利用可能な `mcp__` ツール名を列挙せよ」と問い合わせ、対象 MCP の
ツールが 1 つも無ければ理由を表示して中止します。

```
MCP 接続を確認しています...
  NG playwright: mcp__playwright__* のツールが1つも見つかりません。...
```

`--skip-preflight` で飛ばせますが、飛ばすと上記の事故が起きうるので非推奨です。

## 成功判定

期待文字列の部分一致だけで判定すると、**ページ全文を出力するだけで通ってしまいます**。
それでは「より多くのコンテキストを読んで丸ごと吐き出す」戦略が有利になり、
トークン削減を測るベンチマークとして逆向きのバイアスがかかります。

そのため 3 つの条件をすべて満たした場合のみ成功とします。

| 条件 | 内容 |
|------|------|
| `successIncludes` | 期待する文字列をすべて含む（大文字小文字無視） |
| `successExcludes` | 聞いていない情報を含まない（例: Last Name と Email を聞いたのに Web Site 列が混ざっている） |
| `maxResultChars` | レスポンスが長さ上限を超えない |

失敗した場合はその理由を記録し、実行ログと `results.json` の `failure_reason` に出力します。

## トークン指標

4 種類のトークン（input / output / cache_creation / cache_read）を単純合計しても、
コストにもコンテキスト量にも対応しない中間的な数字にしかなりません。
キャッシュ読み出しは課金上 input の約 1/10、書き込みは 1.25 倍だからです。

そのため用途ごとに指標を分けています。

| 指標 | 定義 | 何を表すか |
|------|------|-----------|
| **Context tokens**（主指標） | `input + cache_creation + cache_read` | モデルが実際に読んだ入力コンテキストの量。キャッシュ経由で渡された分も含む |
| **Billable tokens** | `input + output + cache_creation × 1.25 + cache_read × 0.1` | 課金重みを掛けたトークン数（base input 換算） |
| **Cost (USD)** | Claude CLI の `total_cost_usd` | 実コスト |
| Total tokens | 4 種の単純合計 | 参考値。後方互換のため保持。比較には使わない |

削減率の主指標は **Context tokens** です。smallright の主張は「LLM に渡すコンテキストを
減らす」なので、これが最も直接に対応します。

output トークンはモデルごとに単価が異なるため、Billable では重み付けせずそのまま
加算しています。正確なコスト比較が必要な場合は `total_cost_usd` を見てください。

## 結果の見方

`results/results.md` に表として出力されます。

- **Context / Billable / Cost Reduction**: `(playwright_median - smallright_median) / playwright_median * 100`。正の値が削減（smallright の方が少ない）。
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
