import type {
  BatchExecutor,
  BatchResult,
  BatchStep,
  Services,
  AmbiguousMatch,
} from '../types.js';
import { resolveLocator } from './locator-helper.js';

class BatchExecutorImpl implements BatchExecutor {
  async execute(s: Services, steps: BatchStep[]): Promise<BatchResult> {
    const page = await s.browser.getPage();
    const zones = s.zones.getZones();

    // Take initial snapshot
    const urlBefore = page.url();
    const snapshotBefore = await s.differ.takeSnapshot(page, zones);

    let stepsCompleted = 0;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      try {
        if (step.action === 'click') {
          // Resolve element by text and click
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
            const dialogs = s.browser.consumeDialogMessages();
            const earlyResult: BatchResult & { dialogs?: Array<{ type: string; message: string }> } = {
              success: false,
              stepsCompleted,
              totalSteps: steps.length,
              finalState: stateAtError,
              diff: s.differ.computeDiff(snapshotBefore, snapshotBefore, urlBefore, urlBefore),
              error: {
                stepIndex: i,
                message: `No element matching "${step.text}" was found.\n\nInteractive elements on the page:\n${allTexts}`,
                stateAtError,
              },
            };
            if (dialogs.length > 0) earlyResult.dialogs = dialogs;
            return earlyResult;
          }

          // Ambiguous match is treated as an error
          if ('candidates' in resolved) {
            const ambiguous = resolved as AmbiguousMatch;
            const stateAtError = await s.state.buildActionModeState(page, elements);
            const dialogs = s.browser.consumeDialogMessages();
            const earlyResult: BatchResult & { dialogs?: Array<{ type: string; message: string }> } = {
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
            if (dialogs.length > 0) earlyResult.dialogs = dialogs;
            return earlyResult;
          }

          const locator = resolveLocator(page, resolved);
          await locator.click({ timeout: 10000 });

        } else if (step.action === 'hover') {
          // Resolve element by text and hover
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
            const dialogs = s.browser.consumeDialogMessages();
            const earlyResult: BatchResult & { dialogs?: Array<{ type: string; message: string }> } = {
              success: false,
              stepsCompleted,
              totalSteps: steps.length,
              finalState: stateAtError,
              diff: s.differ.computeDiff(snapshotBefore, snapshotBefore, urlBefore, urlBefore),
              error: {
                stepIndex: i,
                message: `No element matching "${step.text}" was found.\n\nInteractive elements on the page:\n${allTexts}`,
                stateAtError,
              },
            };
            if (dialogs.length > 0) earlyResult.dialogs = dialogs;
            return earlyResult;
          }

          // Ambiguous match is treated as an error
          if ('candidates' in resolved) {
            const ambiguous = resolved as AmbiguousMatch;
            const stateAtError = await s.state.buildActionModeState(page, elements);
            const dialogs = s.browser.consumeDialogMessages();
            const earlyResult: BatchResult & { dialogs?: Array<{ type: string; message: string }> } = {
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
            if (dialogs.length > 0) earlyResult.dialogs = dialogs;
            return earlyResult;
          }

          const locator = resolveLocator(page, resolved);
          await locator.hover({ timeout: 10000 });
          // waitForURL is skipped for hover (no navigation expected)
          await page.waitForTimeout(300);
          stepsCompleted++;
          continue;

        } else if (step.action === 'fill_form') {
          // Fill each field in the form sequentially
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
                .map((e) => `- ${e.label ?? e.placeholder ?? e.text ?? e.name ?? '(unknown)'} (${e.tag})`)
                .join('\n');
              const stateAtError = await s.state.buildActionModeState(page, elements);
              const dialogs = s.browser.consumeDialogMessages();
              const earlyResult: BatchResult & { dialogs?: Array<{ type: string; message: string }> } = {
                success: false,
                stepsCompleted,
                totalSteps: steps.length,
                finalState: stateAtError,
                diff: s.differ.computeDiff(snapshotBefore, snapshotBefore, urlBefore, urlBefore),
                error: {
                  stepIndex: i,
                  message: `fill_form: No field matching "${label}" was found.\n\nForm fields on the page:\n${allLabels}`,
                  stateAtError,
                },
              };
              if (dialogs.length > 0) earlyResult.dialogs = dialogs;
              return earlyResult;
            }

            // Ambiguous match is treated as an error
            if ('candidates' in resolved) {
              const ambiguous = resolved as AmbiguousMatch;
              const stateAtError = await s.state.buildActionModeState(page, elements);
              const dialogs = s.browser.consumeDialogMessages();
              const earlyResult: BatchResult & { dialogs?: Array<{ type: string; message: string }> } = {
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
              if (dialogs.length > 0) earlyResult.dialogs = dialogs;
              return earlyResult;
            }

            const locator = resolveLocator(page, resolved);
            await locator.fill(value);

          }

          stepsCompleted++;
          continue;

        } else if (step.action === 'select') {
          // Resolve select field by label and select the option
          const elements = await s.elements.scan(page);
          const resolved = s.elements.resolveByLabel(step.label ?? '', elements);

          if (resolved === null) {
            const allLabels = elements
              .filter((e) => e.tag === 'select')
              .map((e) => `- ${e.label ?? e.placeholder ?? e.text ?? e.name ?? '(unknown)'} (${e.tag})`)
              .join('\n');
            const stateAtError = await s.state.buildActionModeState(page, elements);
            const dialogs = s.browser.consumeDialogMessages();
            const earlyResult: BatchResult & { dialogs?: Array<{ type: string; message: string }> } = {
              success: false,
              stepsCompleted,
              totalSteps: steps.length,
              finalState: stateAtError,
              diff: s.differ.computeDiff(snapshotBefore, snapshotBefore, urlBefore, urlBefore),
              error: {
                stepIndex: i,
                message: `No select field matching "${step.label}" was found.\n\nSelect fields on the page:\n${allLabels}`,
                stateAtError,
              },
            };
            if (dialogs.length > 0) earlyResult.dialogs = dialogs;
            return earlyResult;
          }

          // Ambiguous match is treated as an error
          if ('candidates' in resolved) {
            const ambiguous = resolved as AmbiguousMatch;
            const stateAtError = await s.state.buildActionModeState(page, elements);
            const dialogs = s.browser.consumeDialogMessages();
            const earlyResult: BatchResult & { dialogs?: Array<{ type: string; message: string }> } = {
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
            if (dialogs.length > 0) earlyResult.dialogs = dialogs;
            return earlyResult;
          }

          const locator = resolveLocator(page, resolved);
          await locator.selectOption(step.value ?? '');

        } else if (step.action === 'navigate') {
          await s.browser.navigateTo(step.url ?? '');
          await s.browser.waitForSpaReady(page);
          // Auto-load profile for the navigated domain
          try {
            const navigatedUrl = page.url();
            const domain = new URL(navigatedUrl).hostname;
            const profile = await s.profiles.load(domain);
            if (profile) {
              s.zones.setZones(profile.zones);
            }
          } catch {
            // Ignore URL parse failures; continue without a profile
          }

        } else if (step.action === 'wait') {
          await page.waitForTimeout(step.ms ?? 1000);

        } else {
          // Unknown action
          const elements = await s.elements.scan(page);
          const stateAtError = await s.state.buildActionModeState(page, elements);
          const dialogs = s.browser.consumeDialogMessages();
          const earlyResult: BatchResult & { dialogs?: Array<{ type: string; message: string }> } = {
            success: false,
            stepsCompleted,
            totalSteps: steps.length,
            finalState: stateAtError,
            diff: s.differ.computeDiff(snapshotBefore, snapshotBefore, urlBefore, urlBefore),
            error: {
              stepIndex: i,
              message: `Unknown action: ${(step as BatchStep).action}`,
              stateAtError,
            },
          };
          if (dialogs.length > 0) earlyResult.dialogs = dialogs;
          return earlyResult;
        }

        // After each step: wait for DOM to settle and re-scan elements (fill_form handles this internally via continue)
        await page.waitForTimeout(500);
        await s.elements.scan(page);
        stepsCompleted++;

      } catch (err: unknown) {
        // On error: capture ActionModeState at the point of failure and return with error info
        const elements = await s.elements.scan(page).catch(() => []);
        const stateAtError = await s.state.buildActionModeState(page, elements);
        const urlNow = page.url();
        const snapshotNow = await s.differ.takeSnapshot(page, zones).catch(() => snapshotBefore);
        const dialogs = s.browser.consumeDialogMessages();
        const catchResult: BatchResult & { dialogs?: Array<{ type: string; message: string }> } = {
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
        if (dialogs.length > 0) {
          catchResult.dialogs = dialogs;
        }
        return catchResult;
      }
    }

    // Success: take final snapshot, compute StateDiff, and return BatchResult
    const urlAfter = page.url();
    const snapshotAfter = await s.differ.takeSnapshot(page, zones);
    const elements = await s.elements.scan(page);
    const finalState = await s.state.buildActionModeState(page, elements);
    const diff = s.differ.computeDiff(snapshotBefore, snapshotAfter, urlBefore, urlAfter);
    const dialogs = s.browser.consumeDialogMessages();

    const result: BatchResult & { dialogs?: Array<{ type: string; message: string }> } = {
      success: true,
      stepsCompleted,
      totalSteps: steps.length,
      finalState,
      diff,
    };
    if (dialogs.length > 0) {
      result.dialogs = dialogs;
    }
    return result;
  }
}

export function createBatchExecutor(): BatchExecutor {
  return new BatchExecutorImpl();
}
