import type { Services } from "../types.js";
import type { ZoneSnapshot } from "../types.js";

export async function navigate(
  s: Services,
  params: { url?: string; back?: boolean }
): Promise<string> {
  if (params.back && params.url) {
    throw new Error("Cannot specify both url and back: true");
  }
  if (!params.back && !params.url) {
    throw new Error("Either url or back: true must be specified");
  }

  const page = await s.browser.getPage();

  if (params.back) {
    const domainBefore = new URL(page.url()).hostname;
    const response = await page.goBack({ waitUntil: "domcontentloaded", timeout: 30000 });
    if (!response) {
      throw new Error("No page in history to go back to");
    }

    const domainAfter = new URL(page.url()).hostname;
    if (domainAfter !== domainBefore) {
      const profile = await s.profiles.load(domainAfter);
      if (profile) {
        s.zones.setZones(profile.zones);
      } else {
        s.zones.setZones([]);
      }
    }

    await s.browser.waitForSpaReady(page);
    const elements = await s.elements.scan(page);

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

  const domain = new URL(params.url!).hostname;
  const profile = await s.profiles.load(domain);

  if (profile?.cookies && profile.cookies.length > 0) {
    const relevantCookies = profile.cookies.filter(c =>
      domain.endsWith(c.domain.replace(/^\./, ''))
    );
    if (relevantCookies.length > 0) {
      await page.context().addCookies(relevantCookies);
    }
  }

  await s.browser.navigateTo(params.url!);

  if (profile) {
    s.zones.setZones(profile.zones);
  }

  await s.browser.waitForSpaReady(page);
  const elements = await s.elements.scan(page);

  // Build zone snapshots if profile was loaded (B6 fix)
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
