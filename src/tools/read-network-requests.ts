import type { Services } from '../types.js';
import { BUFFER_LIMITS } from '../types.js';

function matchesStatus(recordStatus: number | undefined, filter: number | string): boolean {
  if (recordStatus === undefined) return false;

  if (typeof filter === 'number') {
    return recordStatus === filter;
  }

  // String range: "2xx", "3xx", "4xx", "5xx"
  switch (filter) {
    case '2xx': return recordStatus >= 200 && recordStatus < 300;
    case '3xx': return recordStatus >= 300 && recordStatus < 400;
    case '4xx': return recordStatus >= 400 && recordStatus < 500;
    case '5xx': return recordStatus >= 500 && recordStatus < 600;
    default: return false;
  }
}

export async function readNetworkRequests(
  s: Services,
  params: {
    url_pattern?: string;
    status?: number | string;
    method?: string;
    resource_type?: string;
    since?: number;
    limit?: number;
    clear?: boolean;
  },
): Promise<string> {
  // Build regex filter if url_pattern is provided
  let urlRegex: RegExp | undefined;
  if (params.url_pattern !== undefined) {
    try {
      urlRegex = new RegExp(params.url_pattern);
    } catch {
      throw new Error(`Invalid regular expression for url_pattern: "${params.url_pattern}"`);
    }
  }

  const { requests, truncated } = s.browser.getNetworkRequests();
  const totalBuffered = requests.length;

  // Apply filters
  let filtered = requests;

  if (urlRegex !== undefined) {
    filtered = filtered.filter((r) => urlRegex!.test(r.url));
  }

  if (params.status !== undefined) {
    filtered = filtered.filter((r) => matchesStatus(r.status, params.status!));
  }

  if (params.method !== undefined) {
    const methodUpper = params.method.toUpperCase();
    filtered = filtered.filter((r) => r.method.toUpperCase() === methodUpper);
  }

  if (params.resource_type !== undefined) {
    const typeNorm = params.resource_type.toLowerCase();
    filtered = filtered.filter((r) => r.resourceType.toLowerCase() === typeNorm);
  }

  if (params.since !== undefined) {
    filtered = filtered.filter((r) => r.requestedAt >= params.since!);
  }

  // Sort newest first, then apply limit
  filtered = filtered.slice().sort((a, b) => b.requestedAt - a.requestedAt);

  const limit = Math.max(1, Math.min(params.limit ?? 50, BUFFER_LIMITS.network));
  filtered = filtered.slice(0, limit);

  if (params.clear === true) {
    s.browser.clearNetworkRequests();
  }

  return JSON.stringify(
    {
      requests: filtered,
      totalBuffered,
      returned: filtered.length,
      truncated,
    },
    null,
    2,
  );
}
