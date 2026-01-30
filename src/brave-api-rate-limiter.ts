import { promises as fs } from 'fs';
import path from 'path';

interface MonthlyUsage {
  month: string; // Format: "YYYY-MM"
  count: number;
}

/**
 * Specialized rate limiter for Brave Search API with:
 * - 1 request per second maximum
 * - 2000 requests per month maximum
 * - Persistent monthly counter (survives restarts)
 */
export class BraveApiRateLimiter {
  private lastRequestTime: number = 0;
  private readonly minIntervalMs: number;
  private readonly maxRequestsPerMonth: number;
  private readonly usageFilePath: string;
  private monthlyUsage: MonthlyUsage | null = null;
  private initialized: boolean = false;

  constructor(
    requestsPerSecond: number = 1,
    maxRequestsPerMonth: number = 2000
  ) {
    this.minIntervalMs = Math.ceil(1000 / requestsPerSecond);
    this.maxRequestsPerMonth = maxRequestsPerMonth;

    // Store usage file in the module's directory
    const moduleDir = path.dirname(new URL(import.meta.url).pathname);
    this.usageFilePath = path.join(moduleDir, '..', '.brave-api-usage.json');
  }

  private getCurrentMonth(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  private async loadUsage(): Promise<MonthlyUsage> {
    const currentMonth = this.getCurrentMonth();

    try {
      const data = await fs.readFile(this.usageFilePath, 'utf-8');
      const usage: MonthlyUsage = JSON.parse(data);

      // Reset if it's a new month
      if (usage.month !== currentMonth) {
        console.log(`[BraveApiRateLimiter] New month detected, resetting counter from ${usage.month} to ${currentMonth}`);
        return { month: currentMonth, count: 0 };
      }

      return usage;
    } catch {
      // File doesn't exist or is corrupted, start fresh
      return { month: currentMonth, count: 0 };
    }
  }

  private async saveUsage(usage: MonthlyUsage): Promise<void> {
    try {
      await fs.writeFile(this.usageFilePath, JSON.stringify(usage, null, 2));
    } catch (error) {
      console.error('[BraveApiRateLimiter] Failed to save usage data:', error);
    }
  }

  private async init(): Promise<void> {
    if (!this.initialized) {
      this.monthlyUsage = await this.loadUsage();
      this.initialized = true;
      console.log(`[BraveApiRateLimiter] Initialized - Month: ${this.monthlyUsage.month}, Used: ${this.monthlyUsage.count}/${this.maxRequestsPerMonth}`);
    }
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    await this.init();

    // Check monthly limit
    if (this.monthlyUsage!.count >= this.maxRequestsPerMonth) {
      const remaining = this.getDaysUntilReset();
      throw new Error(
        `Brave API monthly limit reached (${this.maxRequestsPerMonth} requests). ` +
        `Resets in ~${remaining} days on the 1st of next month.`
      );
    }

    // Enforce per-second rate limit
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < this.minIntervalMs) {
      const waitTime = this.minIntervalMs - timeSinceLastRequest;
      console.log(`[BraveApiRateLimiter] Rate limiting: waiting ${waitTime}ms`);
      await this.sleep(waitTime);
    }

    // Execute the request
    this.lastRequestTime = Date.now();

    try {
      const result = await fn();

      // Increment counter on success
      this.monthlyUsage!.count++;
      await this.saveUsage(this.monthlyUsage!);

      console.log(`[BraveApiRateLimiter] Request successful. Monthly usage: ${this.monthlyUsage!.count}/${this.maxRequestsPerMonth}`);

      return result;
    } catch (error) {
      // Don't count failed requests against the limit
      throw error;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private getDaysUntilReset(): number {
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const diffMs = nextMonth.getTime() - now.getTime();
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  }

  async getStatus(): Promise<{
    monthlyUsed: number;
    monthlyLimit: number;
    monthlyRemaining: number;
    currentMonth: string;
    daysUntilReset: number;
  }> {
    await this.init();

    return {
      monthlyUsed: this.monthlyUsage!.count,
      monthlyLimit: this.maxRequestsPerMonth,
      monthlyRemaining: this.maxRequestsPerMonth - this.monthlyUsage!.count,
      currentMonth: this.monthlyUsage!.month,
      daysUntilReset: this.getDaysUntilReset(),
    };
  }
}
