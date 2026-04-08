import type { Services, BatchStep } from '../types.js';

export async function runBatch(
  s: Services,
  params: {
    steps: Array<{
      action: string;
      text?: string;
      label?: string;
      value?: string;
      fields?: Record<string, string>;
      url?: string;
      ms?: number;
    }>;
  },
): Promise<string> {
  const result = await s.batch.execute(s, params.steps as BatchStep[]);
  return JSON.stringify(result, null, 2);
}
