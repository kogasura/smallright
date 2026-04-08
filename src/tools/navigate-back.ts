import type { Services } from "../types.js";
import type { ZoneSnapshot } from "../types.js";

export async function navigateBack(
  s: Services,
  _params: Record<string, never>,
): Promise<string> {
  const page = await s.browser.getPage();
  const response = await page.goBack({ waitUntil: "domcontentloaded", timeout: 30000 });
  if (!response) {
    throw new Error("goBack failed: no previous page in history");
  }

  await s.browser.waitForSpaReady(page);
  const elements = await s.elements.scan(page);

  // Build zone snapshots if zones are defined (same as navigate.ts)
  const zoneDefs = s.zones.getZones();
  let zoneSnapshots: ZoneSnapshot[] | undefined;
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
