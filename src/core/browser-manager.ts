import { chromium, type Browser, type Page } from 'playwright';
import type { BrowserManager } from '../types.js';
import { INTERACTIVE_SELECTOR } from './element-registry.js';

class BrowserManagerImpl implements BrowserManager {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private lastDialogMessages: Array<{ type: string; message: string }> = [];

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
    this.lastDialogMessages = [];
    this.page = await browser.newPage();
    this.page.on('dialog', async (dialog) => {
      this.lastDialogMessages.push({ type: dialog.type(), message: dialog.message() });
      await dialog.accept();
    });
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

  async waitForSpaReady(page: Page): Promise<void> {
    const DEFAULT_TIMEOUT = 10000;
    const raw = parseInt(process.env['SMALLRIGHT_WAIT_TIMEOUT'] ?? '10000', 10);
    const timeout = Number.isNaN(raw) || raw <= 0 ? DEFAULT_TIMEOUT : raw;
    const start = Date.now();
    let prevCount = 0;
    let stableCount = 0;

    while (Date.now() - start < timeout) {
      try {
        const count = await page.locator(INTERACTIVE_SELECTOR).count();
        if (count > 0) {
          if (count === prevCount) {
            stableCount++;
          } else {
            stableCount = 0;
            prevCount = count;
          }
          if (stableCount >= 3) return; // 300ms安定で確定
        }
      } catch (e) {
        if (e instanceof Error && e.message.includes('closed')) return; // page closed
        throw e;
      }
      await page.waitForTimeout(100);
    }
    // timeout - continue without error
  }

  consumeDialogMessages(): Array<{ type: string; message: string }> {
    const messages = this.lastDialogMessages;
    this.lastDialogMessages = [];
    return messages;
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
