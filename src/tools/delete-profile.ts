import type { Services } from "../types.js";

export async function deleteProfile(
  s: Services,
  params: { domain: string }
): Promise<string> {
  const deleted = await s.profiles.delete(params.domain);
  if (deleted) {
    return `プロファイルを削除しました: ${params.domain}`;
  } else {
    return `プロファイルが見つかりませんでした: ${params.domain}`;
  }
}
