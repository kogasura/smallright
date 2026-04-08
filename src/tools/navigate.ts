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

  await s.browser.waitForSpaReady(page);
  const elements = await s.elements.scan(page);
  const state = await s.state.buildActionModeState(page, elements);
  const responseJson = JSON.stringify(state, null, 2);
  const dialogs = s.browser.consumeDialogMessages();
  if (dialogs.length > 0) {
    return JSON.stringify({ ...JSON.parse(responseJson), dialogs }, null, 2);
  }
  return responseJson;
}
