import type { Services } from "../types.js";

export async function readPage(
  s: Services,
  params: { zone?: string }
): Promise<string> {
  const page = await s.browser.getPage();
  const zones = s.zones.getZones();

  if (params.zone) {
    // zone specified: return snapshot of that zone
    const snapshot = await s.zones.getZoneSnapshot(page, params.zone);
    return JSON.stringify(snapshot, null, 2);
  }

  if (zones.length > 0) {
    // Zones are defined: prefer the 'main' zone, otherwise use the first zone
    const targetZone = zones.find(z => z.name === 'main') ?? zones[0];
    const snapshot = await s.zones.getZoneSnapshot(page, targetZone.name);
    return JSON.stringify(snapshot, null, 2);
  }

  // No zones defined: fall back to returning the full page state
  const elements = await s.elements.scan(page);
  const state = await s.state.buildActionModeState(page, elements);
  return JSON.stringify(state, null, 2);
}
