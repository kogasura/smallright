import { chromium, type Browser, type Page, type Request, type ConsoleMessage as PWConsoleMessage } from 'playwright';
import type { BrowserManager, ConsoleMessage, NetworkRequestRecord } from '../types.js';
import { BUFFER_LIMITS } from '../types.js';
import { INTERACTIVE_SELECTOR } from './element-registry.js';

class BrowserManagerImpl implements BrowserManager {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private lastDialogMessages: Array<{ type: string; message: string }> = [];
  private consoleMessages: ConsoleMessage[] = [];
  private consoleTruncated = false;
  private networkRequests: NetworkRequestRecord[] = [];
  private networkTruncated = false;
  private requestRecordMap: Map<Request, NetworkRequestRecord> = new Map();
  private static readonly CONSOLE_BUFFER_LIMIT = BUFFER_LIMITS.console;
  private static readonly NETWORK_BUFFER_LIMIT = BUFFER_LIMITS.network;

  private isHeadless(): boolean {
    // CLI: --no-headless or --headless=false
    if (process.argv.includes('--no-headless')) return false;
    if (process.argv.includes('--headless=false')) return false;
    // Env: SMALLRIGHT_HEADLESS=false
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
    // Reset all buffers for new page
    this.lastDialogMessages = [];
    this.consoleMessages = [];
    this.consoleTruncated = false;
    this.networkRequests = [];
    this.networkTruncated = false;
    this.requestRecordMap.clear();

    this.page = await browser.newPage();

    this.page.on('dialog', async (dialog) => {
      this.lastDialogMessages.push({ type: dialog.type(), message: dialog.message() });
      await dialog.accept();
    });

    this.page.on('console', (msg: PWConsoleMessage) => {
      const loc = msg.location();
      const record: ConsoleMessage = {
        type: msg.type(),
        text: msg.text(),
        url: loc.url || undefined,
        lineNumber: loc.lineNumber,
        columnNumber: loc.columnNumber,
        timestamp: Date.now(),
      };
      if (this.consoleMessages.length >= BrowserManagerImpl.CONSOLE_BUFFER_LIMIT) {
        this.consoleMessages.shift();
        this.consoleTruncated = true;
      }
      this.consoleMessages.push(record);
    });

    this.page.on('request', (req: Request) => {
      // リダイレクト元の古いエントリを削除してMap肥大化を防ぐ
      const redirectedFrom = req.redirectedFrom();
      if (redirectedFrom) {
        this.requestRecordMap.delete(redirectedFrom);
      }
      const record: NetworkRequestRecord = {
        url: req.url(),
        method: req.method(),
        resourceType: req.resourceType(),
        requestedAt: Date.now(),
      };
      if (this.networkRequests.length >= BrowserManagerImpl.NETWORK_BUFFER_LIMIT) {
        // Remove the oldest request and clean up its Map entry
        const oldest = this.networkRequests.shift();
        if (oldest !== undefined) {
          // Find and delete the corresponding Map entry
          for (const [key, val] of this.requestRecordMap) {
            if (val === oldest) {
              this.requestRecordMap.delete(key);
              break;
            }
          }
        }
        this.networkTruncated = true;
      }
      this.networkRequests.push(record);
      this.requestRecordMap.set(req, record);
    });

    this.page.on('response', (res) => {
      const record = this.requestRecordMap.get(res.request());
      if (record) {
        record.status = res.status();
        record.statusText = res.statusText();
        const contentType = res.headers()['content-type'];
        record.contentType = contentType || undefined;
        record.respondedAt = Date.now();
        record.durationMs = record.respondedAt - record.requestedAt;
      }
    });

    this.page.on('requestfailed', (req: Request) => {
      const record = this.requestRecordMap.get(req);
      if (record) {
        record.errorText = req.failure()?.errorText ?? 'Unknown error';
        record.respondedAt = Date.now();
        record.durationMs = record.respondedAt - record.requestedAt;
      }
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

  getConsoleMessages(): { messages: ConsoleMessage[]; truncated: boolean } {
    return { messages: this.consoleMessages.map(m => ({ ...m })), truncated: this.consoleTruncated };
  }

  getNetworkRequests(): { requests: NetworkRequestRecord[]; truncated: boolean } {
    return { requests: this.networkRequests.map(r => ({ ...r })), truncated: this.networkTruncated };
  }

  clearConsoleMessages(): void {
    this.consoleMessages = [];
    this.consoleTruncated = false;
  }

  clearNetworkRequests(): void {
    this.networkRequests = [];
    this.networkTruncated = false;
    this.requestRecordMap.clear();
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
