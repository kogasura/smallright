import type { Services } from "../types.js";

export async function readPage(
  s: Services,
  params: { zone?: string }
): Promise<string> {
  const page = await s.browser.getPage();
  const zones = s.zones.getZones();

  if (params.zone) {
    // zone パラメータが指定された場合: 該当ゾーンのスナップショットを返す
    const snapshot = await s.zones.getZoneSnapshot(page, params.zone);
    return JSON.stringify(snapshot, null, 2);
  }

  if (zones.length > 0) {
    // ゾーン定義がある場合: "main" ゾーンを優先、なければ先頭ゾーン
    const targetZone = zones.find(z => z.name === 'main') ?? zones[0];
    const snapshot = await s.zones.getZoneSnapshot(page, targetZone.name);
    return JSON.stringify(snapshot, null, 2);
  }

  // ゾーン定義がない場合: 従来通り全体を返す
  const elements = await s.elements.scan(page);
  const state = await s.state.buildActionModeState(page, elements);
  return JSON.stringify(state, null, 2);
}
