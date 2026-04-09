import type { Services } from "../types.js";

export async function deleteProfile(
  s: Services,
  params: { domain: string }
): Promise<string> {
  const deleted = await s.profiles.delete(params.domain);
  if (deleted) {
    return `Profile deleted: ${params.domain}`;
  } else {
    return `Profile not found: ${params.domain}`;
  }
}
