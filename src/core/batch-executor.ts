import type {
  BatchExecutor,
  BatchResult,
  BatchStep,
  Services,
  AmbiguousMatch,
} from '../types.js';

// Escape special characters in CSS attribute values (e.g. name attribute)
function escapeAttrValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

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
            return {
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
          }

          // Ambiguous match is treated as an error
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
          // Resolve field by label and fill
          const elements = await s.elements.scan(page);
          const resolved = s.elements.resolveByLabel(step.label ?? '', elements);

          if (resolved === null) {
            const allLabels = elements
              .filter((e) => ['input', 'select', 'textarea'].includes(e.tag))
              .map((e) => `- ${e.label ?? e.placeholder ?? e.text ?? e.name ?? '(unknown)'} (${e.tag})`)
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
                message: `No field matching "${step.label}" was found.\n\nForm fields on the page:\n${allLabels}`,
                stateAtError,
              },
            };
          }

          // Ambiguous match is treated as an error
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
                message: `Cannot identify the field for "${step.label}". A name or placeholder attribute is required.`,
                stateAtError,
              },
            };
          }

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
              return {
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
            }

            // Ambiguous match is treated as an error
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
                  message: `fill_form: Cannot identify the field for "${label}".`,
                  stateAtError,
                },
              };
            }

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
            return {
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
          }

          // Ambiguous match is treated as an error
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
                message: `Cannot identify the select field for "${step.label}". A name attribute is required.`,
                stateAtError,
              },
            };
          }

        } else if (step.action === 'navigate') {
          await page.goto(step.url ?? '', { waitUntil: 'domcontentloaded' });
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
          return {
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

    // Success: take final snapshot, compute StateDiff, and return BatchResult
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
