import type { Services } from "../types.js";

export async function getState(
  s: Services,
  params: { mode: "action" | "visual" }
): Promise<string> {
  const page = await s.browser.getPage();
  if (params.mode === "visual") {
    const state = await s.state.buildVisualModeState(page);
    return JSON.stringify(state, null, 2);
  } else {
    const elements = await s.elements.scan(page);
    const state = await s.state.buildActionModeState(page, elements);
    return JSON.stringify(state, null, 2);
  }
}
