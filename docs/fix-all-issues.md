# 全課題対応設計書

## 対応方針判断

### 今回修正（11件）
| ID | 課題 | 理由 |
|---|---|---|
| B1 | click で間違った要素クリック | 致命的。画面外要素をscanから除外する |
| B3 | aria-hidden要素にマッチ | 致命的。scan()で祖先の aria-hidden チェック |
| B4 | click の zone パラメータ無視 | 実装漏れ。scan結果にzoneが未設定 |
| B5 | click の role パラメータ不具合 | ROLE_TAG_MAPのマッチングロジック修正 |
| B6 | プロファイル自動ロード壊れ | navigate.ts L18で buildActionModeState にzonesを渡していない |
| U1 | fill_form StateDiff が変化なし | filledFieldsを成功レスポンスに含める（StateDiffer変更は将来） |
| U4 | 空テキストボタン | aria-label → title → data-testid → type をフォールバック |
| U6 | scanIndex がPublicElementに漏洩 | toPublicElement でランタイム除外 |
| P1 | screenshot トークン超え | format/quality パラメータ追加 |
| P2 | run_batch失敗時に状態2重出力 | finalState を optional に、エラー時は省略 |
| U3/P3 | カレンダーでレスポンス肥大 | state-builder で同種要素を集約（scan自体は変更しない） |

### 将来対応（8件）
| ID | 課題 | 理由 |
|---|---|---|
| B2 | MUI Backdrop タイムアウト | MUI固有。JS dispatch フォールバックが必要で複雑 |
| B7 | define_zones ゾーン名反映 | 影響小。ゾーン機能自体の再設計が必要 |
| U5 | navゾーンで要素重複 | B1/B3の scan 改善で軽減。完全解消はゾーン再設計が必要 |
| U7 | select_option MUI combobox | click + click(option)で代替可能 |
| F1 | テーブル行内操作 | 行コンテキスト対応は設計変更が大きい |
| F2 | チェックボックス操作 | click で代替可能 |
| F3 | SPA遷移後待機 | waitForSpaReady で概ね対応済み |

### 対応不要（2件）
| ID | 課題 | 理由 |
|---|---|---|
| U2 | read_table カレンダー誤認 | `<table>` にマッチする仕様通り。selector指定で回避可能 |
| U8 | evaluate async/await非対応 | Playwrightの仕様。ドキュメント記載で十分 |

---

## 実装単位

### 単位1: scan() の品質改善（B1, B3, U4）
**対象ファイル**: `src/core/element-registry.ts`
**並列可否**: 単位3, 4, 5と並列可。単位2はelement-registry.tsを共有するため単位1完了後に着手

変更内容:
1. **画面外要素の除外（B1）**: `page.evaluate` 内で `getBoundingClientRect()` と `window.innerWidth`/`window.innerHeight` を比較。width=0 または height=0、または rect が完全にビューポート外（right < 0, bottom < 0, left > innerWidth, top > innerHeight）の要素を除外
2. **aria-hidden 祖先チェック（B3）**: `el.closest('[aria-hidden="true"]')` が truthy の場合、その要素を除外。子孫要素もカバーできる
3. **空テキストのフォールバック（U4）**: text が空の場合、`aria-label`（既存）→ `title` → `data-testid` → `type` 属性をフォールバックテキストとして使用。例: `text: "[edit]"` のように括弧付きで返す

### 単位2: click/resolveByText の修正（B4, B5）
**対象ファイル**: `src/core/element-registry.ts`（resolveByText内）, `src/tools/click.ts`
**並列可否**: 単位1完了後に着手（element-registry.ts共有のため）

変更内容:
1. **zone パラメータ修正（B4）**: scan()結果の InteractiveElement には zone フィールドが設定されていない（ゾーン定義済みでも scan は全体スキャン）。resolveByText の zone フィルタは `e.zone === zone` だが、zone が常に undefined。修正: ゾーン定義済みの場合、scan 結果の各要素に対してゾーンのセレクタで `page.evaluate` でゾーン帰属を判定するか、resolveByText にゾーンセレクタ内の要素のみにフィルタするロジックを追加
2. **role パラメータ修正（B5）**: ROLE_TAG_MAP は `{ button: 'button', link: 'a', menuitem: 'li' }` で定義済み。resolveByText 内の roleFiltered フィルタ `e.role === role || e.tag === ROLE_TAG_MAP[role]` は正しい。ただし `prioritizeInteractive` が先に呼ばれた場合、candidates が1件に絞られた後に roleFiltered が呼ばれない。呼び出し順序を確認し、role フィルタ → prioritizeInteractive の順に変更

### 単位3: レスポンス品質改善（U6, P2, U1, U3/P3）
**対象ファイル**: `src/core/state-builder.ts`, `src/core/batch-executor.ts`, `src/types.ts`, `src/tools/fill-form.ts`
**並列可否**: 単位1, 4, 5と並列可

変更内容:
1. **scanIndex ランタイム除外（U6）**: `state-builder.ts` の `toPublicElement` で `const { ref: _ref, selector: _sel, scanIndex: _idx, ...rest } = el;` に変更。型定義は既に `Omit<..., "scanIndex">` で対応済みだが、ランタイムの分割代入が追従していないため修正
2. **batch失敗時の finalState を optional に（P2）**: `types.ts` の `BatchResult` で `finalState` を `finalState?: ActionModeState` に変更。`batch-executor.ts` のエラー時レスポンスで `finalState` を省略
3. **fill_form に filledFields を含める（U1）**: `fill-form.ts` の成功レスポンスに `filledFields: string[]`（入力済みフィールドのラベル一覧）を追加。StateDiffer は変更しない
4. **同種要素の集約（U3/P3）**: `state-builder.ts` の `buildActionModeState` で、actions 配列構築後に同一 tag かつテキストが類似する要素が10件以上ある場合、先頭3件 + `{ tag, text: "...and N more similar elements", disabled: false }` に集約する。判定: 正規表現 `/^\d{4}年\d{1,2}月\d{1,2}日$/` のようなパターンマッチで日付リンクを検出。内部の elements 配列はフルで保持し、click/fill には影響しない

### 単位4: プロファイル自動ロード修正（B6）
**対象ファイル**: `src/tools/navigate.ts`
**並列可否**: 単位1-3, 5と並列可

バグ原因: `navigate.ts` L18 で `s.state.buildActionModeState(page, elements)` を呼んでいるが、第3引数の `zones` を渡していない。`s.zones.setZones(profile.zones)` でゾーン定義は設定されているが、ActionModeState にゾーンスナップショットが含まれないため `zones: []` が返る。

修正内容:
1. navigate.ts でプロファイルロード後、`s.zones.getZones()` が空でない場合、各ゾーンのスナップショットを取得して `buildActionModeState` の第3引数に渡す
2. 具体的には: `const zoneSnapshots = zones.length > 0 ? await Promise.all(zones.map(z => s.zones.getZoneSnapshot(page, z.name))) : undefined;`
3. `s.state.buildActionModeState(page, elements, zoneSnapshots)` に変更

### 単位5: screenshot サイズ制御（P1）
**対象ファイル**: `src/tools/screenshot.ts`, `src/server.ts`
**並列可否**: 単位1-4と並列可

変更内容:
1. screenshot パラメータに `format?: 'png' | 'jpeg'`（デフォルト png）と `quality?: number`（デフォルト 50、jpeg 時のみ有効）を追加
2. Playwrightの `page.screenshot({ type: format, quality: format === 'jpeg' ? quality : undefined })` を使用
3. `server.ts` の screenshot ツール Zod スキーマに `format` と `quality` を追加
4. PNG デフォルトを維持し、トークン削減したい場合は明示的に JPEG を選択する設計
