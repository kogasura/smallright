import type { Services } from "../types.js";

export async function navigate(
  s: Services,
  params: { url: string }
): Promise<string> {
  await s.browser.navigateTo(params.url);
  const page = await s.browser.getPage();

  const domain = new URL(params.url).hostname;
  const profile = await s.profiles.load(domain);
  if (profile) {
    s.zones.setZones(profile.zones);
  }

  const elements = await s.elements.scan(page);
  const state = await s.state.buildActionModeState(page, elements);
  return JSON.stringify(state, null, 2);
}
