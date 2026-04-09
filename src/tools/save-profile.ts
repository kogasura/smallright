import type { Services } from "../types.js";

export async function saveProfile(
  s: Services,
  params: { domain?: string }
): Promise<string> {
  let domain = params.domain;
  if (!domain) {
    const page = await s.browser.getPage();
    const url = page.url();
    domain = new URL(url).hostname;
  }

  const zones = s.zones.getZones();
  if (zones.length === 0) {
    throw new Error('No zone definitions to save. Please define zones first.');
  }
  await s.profiles.save(domain, zones);

  return `Profile saved for: ${domain} (${zones.length} zone(s))`;
}
