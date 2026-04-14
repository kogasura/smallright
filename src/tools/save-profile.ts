import type { Services } from "../types.js";

export async function saveProfile(
  s: Services,
  params: { domain?: string; save_session?: boolean }
): Promise<string> {
  let domain = params.domain;
  if (!domain) {
    const page = await s.browser.getPage();
    const url = page.url();
    domain = new URL(url).hostname;
  }

  const zones = s.zones.getZones();
  if (zones.length === 0 && !params.save_session) {
    throw new Error('No zone definitions to save. Please define zones first.');
  }

  let cookies: import('playwright').Cookie[] | undefined;
  if (params.save_session) {
    const page = await s.browser.getPage();
    const currentUrl = page.url();
    const allCookies = await page.context().cookies();
    const currentDomain = new URL(currentUrl).hostname;
    const now = Date.now() / 1000;
    cookies = allCookies
      .filter(c => currentDomain.endsWith(c.domain.replace(/^\./, '')))
      .filter(c => c.expires === -1 || c.expires > now);
  }

  await s.profiles.save(domain, { zones, cookies });

  const cookiePart = cookies ? `, ${cookies.length} cookie(s)` : '';
  return `Profile saved for: ${domain} (${zones.length} zone(s)${cookiePart})`;
}
