import { chromium, Browser, BrowserContext } from 'playwright';
import { Persona } from './personas.js';
import treeKill from 'tree-kill';
import { spawn } from 'child_process';

export class BrowserPool {
  private browser: Browser | null = null;
  private browserLaunchPromise: Promise<Browser> | null = null;
  private contextCount = 0;
  private readonly MAX_CONTEXTS_PER_BROWSER = 50; // Rotate browser after 50 contexts
  private readonly HEADLESS_MODE = process.env.HEADLESS_MODE !== 'false'; // Allow overriding via env, but default true for MCP (we use Xvfb if needed) -- WAIT, User said 'Headful' is required.
  // Correction: Bounty Hunter strategy says "Headful mode: Run with headless: false. Use Xvfb".
  // So inside the container/server, we run headless: false, but rely on Xvfb.

  constructor() {
    console.log(`[BrowserPool] Initialized. Strategy: Golden Path (Chrome + Headful + Xvfb)`);
  }

  async getContext(persona: Persona): Promise<BrowserContext> {
    const browser = await this.getBrowser();

    // Increment usage count
    this.contextCount++;

    // Create context with persona specific settings matching the "Golden Path"
    // "Clean" args - no aggressive overrides that might leak
    const context = await browser.newContext({
      userAgent: persona.userAgent,
      viewport: persona.viewport,
      locale: persona.locale,
      timezoneId: persona.timezoneId,
      deviceScaleFactor: persona.deviceScaleFactor,
      // Platform is usually set by the browser binary itself, but we can hint it
      // Note: 'platform' context option is not standard in Playwright, handled by UA usually.

      // CRITICAL: Do NOT use stealth.min.js features here, rely on natural headful behavior
      hasTouch: persona.deviceScaleFactor > 1, // Simple heuristic
      isMobile: false,
      javaScriptEnabled: true,
    });

    return context;
  }

  async getBrowser(): Promise<Browser> {
    // If we have a browser and it's healthy and hasn't exceeded usage limit
    if (this.browser && this.browser.isConnected() && this.contextCount < this.MAX_CONTEXTS_PER_BROWSER) {
      return this.browser;
    }

    // If we have a browser but it's old/disconnected, close it
    if (this.browser) {
      console.log(`[BrowserPool] Rotating browser (Contexts: ${this.contextCount}, Connected: ${this.browser.isConnected()})`);
      await this.safeCloseBrowser(this.browser);
      this.browser = null;
    }

    // Ensure we don't have multiple launch attempts
    if (this.browserLaunchPromise) {
      return this.browserLaunchPromise;
    }

    this.browserLaunchPromise = this.launchBrowser();

    try {
      this.browser = await this.browserLaunchPromise;
      this.contextCount = 0;
      return this.browser;
    } finally {
      this.browserLaunchPromise = null;
    }
  }

  private async launchBrowser(): Promise<Browser> {
    console.log(`[BrowserPool] Launching new Chrome instance (Channel: chrome, Headless: false)...`);

    try {
      // Golden Path:
      // 1. channel: 'chrome' (Requires Google Chrome)
      // 2. headless: false (Headful)
      // 3. args: Xvfb display (if needed, usually handled by env DISPLAY)

      const browser = await chromium.launch({
        channel: 'chrome',
        headless: false,
        args: [
          '--no-sandbox', // Still often needed in Docker/Root
          '--disable-dev-shm-usage', // Docker memory limit fix
          // '--display=:99', // We rely on env.DISPLAY or xvfb-run, or we can force it if we detect it

          // AVOID: --disable-gpu (Bounty Hunter says avoid it)
          // AVOID: --disable-accelerated-2d-canvas
          // AVOID: --mute-audio (Let it be natural)
        ],
        // Set env explicitly if we want to force Xvfb display, though usually it's set in shell
        env: {
          ...process.env,
          // If DISPLAY is missing and we think we are in headless linux, maybe default to :99?
          // Note: Setting DISPLAY here blindly might break if Xvfb isn't running on :99.
          // Better to assume the user/script sets up the environment (like docker-compose or setup script).
        }
      });

      return browser;
    } catch (error) {
      console.error(`[BrowserPool] Failed to launch Chrome:`, error);
      console.error(`[BrowserPool] Ensure 'google-chrome-stable' is installed and Xvfb is running (DISPLAY set).`);
      throw error;
    }
  }

  private async safeCloseBrowser(browser: Browser) {
    try {
      await browser.close();
    } catch (e) {
      console.error(`[BrowserPool] Error closing browser:`, e);
    }
  }

  async closeAll(): Promise<void> {
    console.log(`[BrowserPool] Shutting down...`);
    if (this.browser) {
      await this.safeCloseBrowser(this.browser);
      this.browser = null;
    }

    // Force kill any lingering chrome processes started by this process group
    // This is a "scorched earth" policy to prevent zombies
    // In a real localized app we might be more careful, but for a dedicated scraping MCP this is safer
    // We attempt to identify children.

    // Note: tree-kill requires a PID. We use the current process's PID if we want to kill *everything*,
    // but typically we want to kill just the chrome children. 
    // Since Playwright manages the children, browser.close() *should* work.
    // But as a fallback, we can rely on the OS to clean up if we exit, or use a specific kill script.

    // Implementation note: "scripts/kill-scrapers.sh" exists in Bounty Hunter.
    // Here we can just log that we are done.
  }
}
