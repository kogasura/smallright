import type {
  BatchExecutor,
  BatchResult,
  BatchStep,
  Services,
  AmbiguousMatch,
} from '../types.js';

// name属性等のCSSセレクタ内での特殊文字をエスケープする
function escapeAttrValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

class BatchExecutorImpl implements BatchExecutor {
  async execute(s: Services, steps: BatchStep[]): Promise<BatchResult> {
    const page = await s.browser.getPage();
    const zones = s.zones.getZones();

    // 初期スナップショット取得
    const urlBefore = page.url();
    const snapshotBefore = await s.differ.takeSnapshot(page, zones);

    let stepsCompleted = 0;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      try {
        if (step.action === 'click') {
          // テキストで要素を解決してクリック
          const elements = await s.elements.scan(page);
          const resolved = s.elements.resolveByText(
            step.text ?? '',
            elements,
            undefined,
            undefined,
          );

          if (resolved === null) {
            const allTexts = elements.map((e) => `- ${e.text} (${e.tag})`).join('\n');
            const stateAtError = await s.state.buildActionModeState(page, elements);
            return {
              success: false,
              stepsCompleted,
              totalSteps: steps.length,
              finalState: stateAtError,
              diff: s.differ.computeDiff(snapshotBefore, snapshotBefore, urlBefore, urlBefore),
              error: {
                stepIndex: i,
                message: `"${step.text}" に一致する要素が見つかりません。\n\nページ上のインタラクティブ要素一覧:\n${allTexts}`,
                stateAtError,
              },
            };
          }

          // 曖昧マッチはエラー扱い
          if ('candidates' in resolved) {
            const ambiguous = resolved as AmbiguousMatch;
            const stateAtError = await s.state.buildActionModeState(page, elements);
            return {
              success: false,
              stepsCompleted,
              totalSteps: steps.length,
              finalState: stateAtError,
              diff: s.differ.computeDiff(snapshotBefore, snapshotBefore, urlBefore, urlBefore),
              error: {
                stepIndex: i,
                message: ambiguous.message,
                stateAtError,
              },
            };
          }

          if (resolved.selector) {
            await page.locator(resolved.selector).click({ timeout: 10000 });
          } else {
            await page.locator(`text=${step.text}`).first().click({ timeout: 10000 });
          }

        } else if (step.action === 'fill') {
          // ラベルでフィールドを解決して入力
          const elements = await s.elements.scan(page);
          const resolved = s.elements.resolveByLabel(step.label ?? '', elements);

          if (resolved === null) {
            const allLabels = elements
              .filter((e) => ['input', 'select', 'textarea'].includes(e.tag))
              .map((e) => `- ${e.label ?? e.placeholder ?? e.text ?? e.name ?? '(不明)'} (${e.tag})`)
              .join('\n');
            const stateAtError = await s.state.buildActionModeState(page, elements);
            return {
              success: false,
              stepsCompleted,
              totalSteps: steps.length,
              finalState: stateAtError,
              diff: s.differ.computeDiff(snapshotBefore, snapshotBefore, urlBefore, urlBefore),
              error: {
                stepIndex: i,
                message: `"${step.label}" に一致するフィールドが見つかりません。\n\nページ上のフォームフィールド一覧:\n${allLabels}`,
                stateAtError,
              },
            };
          }

          // 曖昧マッチはエラー扱い
          if ('candidates' in resolved) {
            const ambiguous = resolved as AmbiguousMatch;
            const stateAtError = await s.state.buildActionModeState(page, elements);
            return {
              success: false,
              stepsCompleted,
              totalSteps: steps.length,
              finalState: stateAtError,
              diff: s.differ.computeDiff(snapshotBefore, snapshotBefore, urlBefore, urlBefore),
              error: {
                stepIndex: i,
                message: ambiguous.message,
                stateAtError,
              },
            };
          }

          if (resolved.selector) {
            await page.locator(resolved.selector).fill(step.value ?? '');
          } else if (resolved.name) {
            await page.locator(`[name="${escapeAttrValue(resolved.name)}"]`).fill(step.value ?? '');
          } else if (resolved.placeholder) {
            await page.getByPlaceholder(resolved.placeholder).fill(step.value ?? '');
          } else {
            const stateAtError = await s.state.buildActionModeState(page, elements);
            return {
              success: false,
              stepsCompleted,
              totalSteps: steps.length,
              finalState: stateAtError,
              diff: s.differ.computeDiff(snapshotBefore, snapshotBefore, urlBefore, urlBefore),
              error: {
                stepIndex: i,
                message: `"${step.label}" のフィールドを特定できません。name属性またはplaceholder属性が必要です。`,
                stateAtError,
              },
            };
          }

        } else if (step.action === 'fill_form') {
          // フォームの各フィールドを順次入力
          const fieldEntries = Object.entries(step.fields ?? {});
          let elements = await s.elements.scan(page);

          for (const [label, value] of fieldEntries) {
            let resolved = s.elements.resolveByLabel(label, elements);

            if (resolved === null) {
              elements = await s.elements.scan(page);
              resolved = s.elements.resolveByLabel(label, elements);
            }

            if (resolved === null) {
              const allLabels = elements
                .filter((e) => ['input', 'select', 'textarea'].includes(e.tag))
                .map((e) => `- ${e.label ?? e.placeholder ?? e.text ?? e.name ?? '(不明)'} (${e.tag})`)
                .join('\n');
              const stateAtError = await s.state.buildActionModeState(page, elements);
              return {
                success: false,
                stepsCompleted,
                totalSteps: steps.length,
                finalState: stateAtError,
                diff: s.differ.computeDiff(snapshotBefore, snapshotBefore, urlBefore, urlBefore),
                error: {
                  stepIndex: i,
                  message: `fill_form: "${label}" に一致するフィールドが見つかりません。\n\nページ上のフォームフィールド一覧:\n${allLabels}`,
                  stateAtError,
                },
              };
            }

            // 曖昧マッチはエラー扱い
            if ('candidates' in resolved) {
              const ambiguous = resolved as AmbiguousMatch;
              const stateAtError = await s.state.buildActionModeState(page, elements);
              return {
                success: false,
                stepsCompleted,
                totalSteps: steps.length,
                finalState: stateAtError,
                diff: s.differ.computeDiff(snapshotBefore, snapshotBefore, urlBefore, urlBefore),
                error: {
                  stepIndex: i,
                  message: `fill_form: ${ambiguous.message}`,
                  stateAtError,
                },
              };
            }

            if (resolved.selector) {
              await page.locator(resolved.selector).fill(value);
            } else if (resolved.name) {
              await page.locator(`[name="${escapeAttrValue(resolved.name)}"]`).fill(value);
            } else if (resolved.placeholder) {
              await page.getByPlaceholder(resolved.placeholder).fill(value);
            } else {
              const stateAtError = await s.state.buildActionModeState(page, elements);
              return {
                success: false,
                stepsCompleted,
                totalSteps: steps.length,
                finalState: stateAtError,
                diff: s.differ.computeDiff(snapshotBefore, snapshotBefore, urlBefore, urlBefore),
                error: {
                  stepIndex: i,
                  message: `fill_form: "${label}" のフィールドを特定できません。`,
                  stateAtError,
                },
              };
            }

          }

          stepsCompleted++;
          continue;

        } else if (step.action === 'select') {
          // ラベルでセレクトフィールドを解決して選択
          const elements = await s.elements.scan(page);
          const resolved = s.elements.resolveByLabel(step.label ?? '', elements);

          if (resolved === null) {
            const allLabels = elements
              .filter((e) => e.tag === 'select')
              .map((e) => `- ${e.label ?? e.placeholder ?? e.text ?? e.name ?? '(不明)'} (${e.tag})`)
              .join('\n');
            const stateAtError = await s.state.buildActionModeState(page, elements);
            return {
              success: false,
              stepsCompleted,
              totalSteps: steps.length,
              finalState: stateAtError,
              diff: s.differ.computeDiff(snapshotBefore, snapshotBefore, urlBefore, urlBefore),
              error: {
                stepIndex: i,
                message: `"${step.label}" に一致するセレクトフィールドが見つかりません。\n\nページ上のセレクトフィールド一覧:\n${allLabels}`,
                stateAtError,
              },
            };
          }

          // 曖昧マッチはエラー扱い
          if ('candidates' in resolved) {
            const ambiguous = resolved as AmbiguousMatch;
            const stateAtError = await s.state.buildActionModeState(page, elements);
            return {
              success: false,
              stepsCompleted,
              totalSteps: steps.length,
              finalState: stateAtError,
              diff: s.differ.computeDiff(snapshotBefore, snapshotBefore, urlBefore, urlBefore),
              error: {
                stepIndex: i,
                message: ambiguous.message,
                stateAtError,
              },
            };
          }

          if (resolved.selector) {
            await page.locator(resolved.selector).selectOption(step.value ?? '');
          } else if (resolved.name) {
            await page.locator(`select[name="${escapeAttrValue(resolved.name)}"]`).selectOption(step.value ?? '');
          } else {
            const stateAtError = await s.state.buildActionModeState(page, elements);
            return {
              success: false,
              stepsCompleted,
              totalSteps: steps.length,
              finalState: stateAtError,
              diff: s.differ.computeDiff(snapshotBefore, snapshotBefore, urlBefore, urlBefore),
              error: {
                stepIndex: i,
                message: `"${step.label}" のセレクトフィールドを特定できません。name属性が必要です。`,
                stateAtError,
              },
            };
          }

        } else if (step.action === 'navigate') {
          await page.goto(step.url ?? '', { waitUntil: 'domcontentloaded' });
          // ナビゲート先ドメインのプロファイルを自動ロード
          try {
            const navigatedUrl = page.url();
            const domain = new URL(navigatedUrl).hostname;
            const profile = await s.profiles.load(domain);
            if (profile) {
              s.zones.setZones(profile.zones);
            }
          } catch {
            // URLパース失敗等は無視してプロファイルなしのまま続行
          }

        } else if (step.action === 'wait') {
          await page.waitForTimeout(step.ms ?? 1000);

        } else {
          // 未知のアクション
          const elements = await s.elements.scan(page);
          const stateAtError = await s.state.buildActionModeState(page, elements);
          return {
            success: false,
            stepsCompleted,
            totalSteps: steps.length,
            finalState: stateAtError,
            diff: s.differ.computeDiff(snapshotBefore, snapshotBefore, urlBefore, urlBefore),
            error: {
              stepIndex: i,
              message: `未知のアクション: ${(step as BatchStep).action}`,
              stateAtError,
            },
          };
        }

        // 各ステップ後: DOM安定待ち + 要素再スキャン（fill_formは内部で実施済みのためcontinueで来ない）
        await page.waitForTimeout(500);
        await s.elements.scan(page);
        stepsCompleted++;

      } catch (err: unknown) {
        // エラー時: その時点のActionModeStateを取得してエラー情報付きで返す
        const elements = await s.elements.scan(page).catch(() => []);
        const stateAtError = await s.state.buildActionModeState(page, elements);
        const urlNow = page.url();
        const snapshotNow = await s.differ.takeSnapshot(page, zones).catch(() => snapshotBefore);
        return {
          success: false,
          stepsCompleted,
          totalSteps: steps.length,
          finalState: stateAtError,
          diff: s.differ.computeDiff(snapshotBefore, snapshotNow, urlBefore, urlNow),
          error: {
            stepIndex: i,
            message: err instanceof Error ? err.message : String(err),
            stateAtError,
          },
        };
      }
    }

    // 成功時: 最終スナップショット → StateDiff計算 → BatchResult返却
    const urlAfter = page.url();
    const snapshotAfter = await s.differ.takeSnapshot(page, zones);
    const elements = await s.elements.scan(page);
    const finalState = await s.state.buildActionModeState(page, elements);
    const diff = s.differ.computeDiff(snapshotBefore, snapshotAfter, urlBefore, urlAfter);

    return {
      success: true,
      stepsCompleted,
      totalSteps: steps.length,
      finalState,
      diff,
    };
  }
}

export function createBatchExecutor(): BatchExecutor {
  return new BatchExecutorImpl();
}
