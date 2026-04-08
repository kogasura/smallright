import type { Services, ZoneDefinition } from "../types.js";

export async function defineZones(
  s: Services,
  params: { zones: Array<{ name: string; selector: string; description?: string }> }
): Promise<string> {
  const zones: ZoneDefinition[] = params.zones.map(z => ({
    name: z.name,
    selector: z.selector,
    ...(z.description !== undefined ? { description: z.description } : {}),
  }));
  s.zones.setZones(zones);
  return `Zone definitions updated. Registered ${zones.length} zone(s): ${zones.map(z => z.name).join(', ')}`;
}
