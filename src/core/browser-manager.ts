import { chromium, type Browser, type Page } from 'playwright';
import type { BrowserManager } from '../types.js';

class BrowserManagerImpl implements BrowserManager {
  private browser: Browser | null = null;
  private page: Page | null = null;

  private isHeadless(): boolean {
    const envVal = process.env['SMALLRIGHT_HEADLESS'];
    if (envVal === undefined || envVal === '') return true;
    return envVal !== 'false';
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browser && this.browser.isConnected()) {
      return this.browser;
    }
    this.browser = await chromium.launch({
      headless: this.isHeadless(),
    });
    return this.browser;
  }

  async getPage(): Promise<Page> {
    if (this.page && !this.page.isClosed()) {
      return this.page;
    }
    const browser = await this.getBrowser();
    this.page = await browser.newPage();
    await this.page.setViewportSize({ width: 1280, height: 720 });
    return this.page;
  }

  async navigateTo(url: string): Promise<void> {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Unsupported protocol: ${parsed.protocol}`);
    }
    const page = await this.getPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }
}

export function createBrowserManager(): BrowserManager {
  return new BrowserManagerImpl();
}
