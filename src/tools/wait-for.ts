import type { Services } from "../types.js";

export async function waitFor(
  s: Services,
  params: { text?: string; selector?: string; timeout?: number },
): Promise<string> {
  const { text, selector, timeout = 10000 } = params;
  if (!text && !selector) {
    throw new Error("text または selector を指定してください");
  }

  const page = await s.browser.getPage();

  if (text) {
    await page.getByText(text).first().waitFor({ state: "visible", timeout });
  } else {
    await page.locator(selector!).first().waitFor({ state: "visible", timeout });
  }

  await s.browser.waitForSpaReady(page);
  const elements = await s.elements.scan(page);

  // Build zone snapshots if zones are defined (navigate.ts と同パターン)
  const zoneDefs = s.zones.getZones();
  let zoneSnapshots: import("../types.js").ZoneSnapshot[] | undefined;
  if (zoneDefs.length > 0) {
    zoneSnapshots = await Promise.all(
      zoneDefs.map(z => s.zones.getZoneSnapshot(page, z.name))
    );
  }

  const state = await s.state.buildActionModeState(page, elements, zoneSnapshots);
  const responseJson = JSON.stringify(state, null, 2);
  const dialogs = s.browser.consumeDialogMessages();
  if (dialogs.length > 0) {
    return JSON.stringify({ ...JSON.parse(responseJson), dialogs }, null, 2);
  }
  return responseJson;
}
