import { access } from 'fs/promises';
import type { Services } from '../types.js';

export async function uploadFile(
  s: Services,
  params: { paths: string[]; label?: string; selector?: string },
): Promise<string> {
  if (params.paths.length === 0) {
    throw new Error('paths must contain at least one file path.');
  }

  // Verify all files exist before attempting upload
  for (const filePath of params.paths) {
    try {
      await access(filePath);
    } catch {
      throw new Error(`File not found or not accessible: ${filePath}`);
    }
  }

  const page = await s.browser.getPage();

  // Resolve the file input locator
  let locator;
  if (params.label) {
    locator = page.getByLabel(params.label);
  } else if (params.selector) {
    locator = page.locator(params.selector);
  } else {
    locator = page.locator('input[type=file]').first();
  }

  await locator.setInputFiles(params.paths);

  return JSON.stringify(
    { success: true, paths: params.paths },
    null,
    2,
  );
}
