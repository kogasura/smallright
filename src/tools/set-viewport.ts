import type { Services } from "../types.js";
import type { ZoneSnapshot } from "../types.js";

const PRESETS = {
  mobile:  { width: 375,  height: 812  },
  tablet:  { width: 768,  height: 1024 },
  desktop: { width: 1280, height: 720  },
} as const;

export async function setViewport(
  s: Services,
  params: { width?: number; height?: number; preset?: "mobile" | "tablet" | "desktop" },
): Promise<string> {
  const base = params.preset ? PRESETS[params.preset] : undefined;
  const width  = params.width  ?? base?.width;
  const height = params.height ?? base?.height;
  if (!width || !height) {
    throw new Error("width/height または preset を指定してください");
  }

  const page = await s.browser.getPage();
  await page.setViewportSize({ width, height });

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
