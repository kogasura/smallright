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
    throw new Error('保存するゾーン定義がありません。先にゾーンを定義してください。');
  }
  await s.profiles.save(domain, zones);

  return `プロファイルを保存しました: ${domain}（ゾーン数: ${zones.length}）`;
}
