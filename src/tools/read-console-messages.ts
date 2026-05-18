import type { Services } from '../types.js';
import { BUFFER_LIMITS } from '../types.js';

export async function readConsoleMessages(
  s: Services,
  params: { pattern?: string; level?: "log" | "info" | "warn" | "error" | "debug"; since?: number; limit?: number; clear?: boolean },
): Promise<string> {
  // Build regex filter if pattern is provided
  let regex: RegExp | undefined;
  if (params.pattern !== undefined) {
    try {
      regex = new RegExp(params.pattern);
    } catch {
      throw new Error(`Invalid regular expression for pattern: "${params.pattern}"`);
    }
  }

  const { messages, truncated } = s.browser.getConsoleMessages();
  const totalBuffered = messages.length;

  // Apply filters
  let filtered = messages;

  if (regex !== undefined) {
    filtered = filtered.filter((m) => regex!.test(m.text));
  }

  if (params.level !== undefined) {
    filtered = filtered.filter((m) => m.type === params.level);
  }

  if (params.since !== undefined) {
    filtered = filtered.filter((m) => m.timestamp >= params.since!);
  }

  // Sort newest first, then apply limit
  filtered = filtered.slice().sort((a, b) => b.timestamp - a.timestamp);

  const limit = Math.max(1, Math.min(params.limit ?? 100, BUFFER_LIMITS.console));
  filtered = filtered.slice(0, limit);

  if (params.clear === true) {
    s.browser.clearConsoleMessages();
  }

  return JSON.stringify(
    {
      messages: filtered,
      totalBuffered,
      returned: filtered.length,
      truncated,
    },
    null,
    2,
  );
}
