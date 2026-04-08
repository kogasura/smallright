import type { Services } from "../types.js";

export async function pressKey(
  s: Services,
  params: { key: string },
): Promise<string> {
  const page = await s.browser.getPage();
  const zones = s.zones.getZones();

  const urlBefore = page.url();
  const snapshotBefore = await s.differ.takeSnapshot(page, zones);

  try {
    await page.keyboard.press(params.key);
  } catch (err) {
    throw new Error(
      `Failed to press key "${params.key}": ${err instanceof Error ? err.message : String(err)}`
    );
  }

  await page.waitForTimeout(300);

  const urlAfter = page.url();
  const snapshotAfter = await s.differ.takeSnapshot(page, zones);

  const diff = s.differ.computeDiff(snapshotBefore, snapshotAfter, urlBefore, urlAfter);
  const dialogs = s.browser.consumeDialogMessages();
  const result = dialogs.length > 0 ? { ...diff, dialogs } : diff;
  return JSON.stringify(result, null, 2);
}
