import type { Services } from "../types.js";

export async function listProfiles(
  s: Services,
  _params: Record<string, never>
): Promise<string> {
  const profiles = await s.profiles.list();
  return JSON.stringify(profiles, null, 2);
}
