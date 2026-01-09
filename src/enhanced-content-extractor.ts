import axios from 'axios';
import * as cheerio from 'cheerio';
import { Page } from 'playwright';
import { ContentExtractionOptions, SearchResult } from './types.js';
import { cleanText, getWordCount, getContentPreview, generateTimestamp, isPdfUrl } from './utils.js';
import { BrowserPool } from './browser-pool.js';
import { getRandomPersona } from './personas.js';

export class EnhancedContentExtractor {
  private readonly defaultTimeout: number;
  private readonly maxContentLength: number;
  private browserPool: BrowserPool;
  private fallbackThreshold: number;

  constructor() {
    this.defaultTimeout = parseInt(process.env.DEFAULT_TIMEOUT || '30000', 10);

    // Read MAX_CONTENT_LENGTH from environment variable, fallback to 500KB
    const envMaxLength = process.env.MAX_CONTENT_LENGTH;
    this.maxContentLength = envMaxLength ? parseInt(envMaxLength, 10) : 500000;

    // Validate the parsed value
    if (isNaN(this.maxContentLength) || this.maxContentLength < 0) {
      console.warn(`[EnhancedContentExtractor] Invalid MAX_CONTENT_LENGTH value: ${envMaxLength}, using default 500000`);
      this.maxContentLength = 500000;
    }

    this.browserPool = new BrowserPool();
    this.fallbackThreshold = parseInt(process.env.BROWSER_FALLBACK_THRESHOLD || '3', 10);

    console.log(`[EnhancedContentExtractor] Configuration: timeout=${this.defaultTimeout}, maxContentLength=${this.maxContentLength}, fallbackThreshold=${this.fallbackThreshold}`);
  }

  async extractContent(options: ContentExtractionOptions): Promise<string> {
    const { url } = options;

    console.log(`[EnhancedContentExtractor] Starting extraction for: ${url}`);

    // First, try with regular HTTP client (faster)
    try {
      const content = await this.extractWithAxios(options);
      console.log(`[EnhancedContentExtractor] Successfully extracted with axios: ${content.length} chars`);
      return content;
    } catch (error) {
      console.log(`[EnhancedContentExtractor] Axios failed: ${error instanceof Error ? error.message : 'Unknown error'}`);

      // Check if this looks like a case where browser would help
      if (this.shouldUseBrowser(error, url)) {
        console.log(`[EnhancedContentExtractor] Falling back to headless browser for: ${url}`);
        try {
          const content = await this.extractWithBrowser(options);
          console.log(`[EnhancedContentExtractor] Successfully extracted with browser: ${content.length} chars`);
          return content;
        } catch (browserError) {
          console.error(`[EnhancedContentExtractor] Browser extraction also failed:`, browserError);
          throw new Error(`Both axios and browser extraction failed for ${url}`);
        }
      } else {
        throw error;
      }
    }
  }

  private async extractWithAxios(options: ContentExtractionOptions): Promise<string> {
    const { url, timeout = this.defaultTimeout, maxContentLength = this.maxContentLength } = options;

    // Use a persona for headers to look more realistic even in axios
    const persona = getRandomPersona();

    const response = await axios.get(url, {
      headers: {
        'User-Agent': persona.userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': persona.locale + ',en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0',
      },
      timeout,
      // Remove maxContentLength from axios config - handle truncation manually
      validateStatus: (status: number) => status < 400,
    });

    let content = this.parseContent(response.data);

    // Truncate content if it exceeds the limit (instead of axios throwing an error)
    if (maxContentLength && content.length > maxContentLength) {
      console.log(`[EnhancedContentExtractor] Content truncated from ${content.length} to ${maxContentLength} characters for ${url}`);
      content = content.substring(0, maxContentLength);
    }

    // Check if we got a meaningful response
    if (this.isLowQualityContent(content)) {
      throw new Error('Low quality content detected - likely bot detection');
    }

    return content;
  }

  private async extractWithBrowser(options: ContentExtractionOptions): Promise<string> {
    const { url, timeout = this.defaultTimeout } = options;

    // Get a persona for this session
    const persona = getRandomPersona();

    // Get a clean context matching the persona
    const context = await this.browserPool.getContext(persona);

    try {
      const page = await context.newPage();

      // Golden Path:
      // 1. NO stealth scripts (navigator overrides) if using Headful Chrome
      // 2. Minimal interception (only block media to save bandwidth, but be careful with anti-bot detection that checks for image loading)

      // Set up request interception to block unnecessary resources
      // NOTE: Some advanced anti-bots check if images load. If we get blocked, we might need to enable images.
      await page.route('**/*', (route) => {
        const resourceType = route.request().resourceType();

        // Block fonts and media, but maybe allow images to be safer?
        // Let's stick to blocking them for speed for now, enable if needed.
        if (['font', 'media'].includes(resourceType)) {
          route.abort();
        } else {
          route.continue();
        }
      });

      // Navigate with realistic options and better error handling
      console.log(`[BrowserExtractor] Navigating to ${url} with persona ${persona.name}`);

      try {
        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: timeout // Use full configured timeout
        });
      } catch (gotoError) {
        // Handle specific protocol errors
        const errorMessage = gotoError instanceof Error ? gotoError.message : String(gotoError);

        if (errorMessage.includes('ERR_HTTP2_PROTOCOL_ERROR') || errorMessage.includes('HTTP2')) {
          console.log(`[BrowserExtractor] HTTP/2 error detected, retrying (usually browser handles fallback but just in case)`);
          // If we're already in a real browser, we might just need to retry or ignore
          // Real Chrome handles HTTP2 fallback better than axios
          throw gotoError;
        } else {
          throw gotoError;
        }
      }

      // Quick human simulation - reduced time but high value for "activeness" checks
      await this.simulateHumanBehavior(page);

      // Quick check for main content
      try {
        await page.waitForSelector('article, main, .content, .post-content, .entry-content, body', {
          timeout: 5000 // Give it a bit more time for hydration
        });
      } catch {
        console.log(`[BrowserExtractor] No main content selector found, proceeding anyway`);
      }

      const html = await page.content();
      const content = this.parseContent(html);

      await context.close();
      return content;

    } catch (error) {
      console.error(`[BrowserExtractor] Browser extraction failed for ${url}:`, error);
      // Ensure context is closed
      try { await context.close(); } catch { }
      throw error;
    }
  }

  private async simulateHumanBehavior(page: Page): Promise<void> {
    try {
      // Random mouse movements
      await page.mouse.move(
        Math.random() * 800,
        Math.random() * 600
      );

      // Random scroll (common human behavior)
      const scrollY = Math.random() * 500;
      await page.evaluate((y) => window.scrollTo(0, y), scrollY);

      // Small random delay
      await page.waitForTimeout(500 + Math.random() * 1000);
    } catch {
      // Ignore simulation errors
      console.log(`[BrowserExtractor] Behavior simulation failed, continuing`);
    }
  }

  private shouldUseBrowser(error: any, url: string): boolean {
    // Conditions where browser is likely to succeed where axios failed
    const indicators = [
      // HTTP status codes that suggest bot detection
      error.response?.status === 403,
      error.response?.status === 429,
      error.response?.status === 503,

      // Error messages suggesting JS requirement
      error.message?.includes('timeout'),
      error.message?.includes('Access denied'),
      error.message?.includes('Forbidden'),
      error.message?.includes('Low quality content detected'),

      // Response content suggesting bot detection
      error.response?.data?.includes('Please enable JavaScript'),
      error.response?.data?.includes('captcha'),
      error.response?.data?.includes('unusual traffic'),
      error.response?.data?.includes('robot'),

      // Sites known to be JS-heavy
      url.includes('twitter.com'),
      url.includes('facebook.com'),
      url.includes('instagram.com'),
      url.includes('linkedin.com'),
      url.includes('reddit.com'),
      url.includes('medium.com'),
    ];

    return indicators.some(indicator => indicator === true);
  }

  private isLowQualityContent(content: string): boolean {
    const lowQualityIndicators = [
      content.length < 100,
      content.includes('Please enable JavaScript'),
      content.includes('Access Denied'),
      content.includes('403 Forbidden'),
      content.includes('captcha'),
      content.includes('unusual traffic'),
      content.includes('robot'),
      content.trim() === '',
    ];

    return lowQualityIndicators.some(indicator => indicator === true);
  }

  async extractContentForResults(results: SearchResult[], targetCount: number = results.length): Promise<SearchResult[]> {
    console.log(`[EnhancedContentExtractor] Processing up to ${results.length} results to get ${targetCount} non-PDF results`);

    // Filter out PDF files first
    const nonPdfResults = results.filter(result => !isPdfUrl(result.url));
    const resultsToProcess = nonPdfResults.slice(0, Math.min(targetCount * 2, 10)); // Process extra to account for failures

    console.log(`[EnhancedContentExtractor] Processing ${resultsToProcess.length} non-PDF results concurrently`);

    // Process results concurrently with timeout
    const extractionPromises = resultsToProcess.map(async (result): Promise<SearchResult> => {
      try {
        // Use a race condition with timeout to prevent hanging
        const extractionPromise = this.extractContent({
          url: result.url,
          timeout: 45000 // Increased for Headful Chrome
        });

        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Content extraction timeout')), 50000);
        });

        const content = await Promise.race([extractionPromise, timeoutPromise]);
        const cleanedContent = cleanText(content, this.maxContentLength);

        console.log(`[EnhancedContentExtractor] Successfully extracted: ${result.url}`);
        return {
          ...result,
          fullContent: cleanedContent,
          contentPreview: getContentPreview(cleanedContent),
          wordCount: getWordCount(cleanedContent),
          timestamp: generateTimestamp(),
          fetchStatus: 'success' as const,
        };
      } catch (error) {
        console.log(`[EnhancedContentExtractor] Failed to extract: ${result.url} - ${error instanceof Error ? error.message : 'Unknown error'}`);
        return {
          ...result,
          fullContent: '',
          contentPreview: '',
          wordCount: 0,
          timestamp: generateTimestamp(),
          fetchStatus: 'error' as const,
          error: this.getSpecificErrorMessage(error),
        };
      }
    });

    // Wait for all extractions to complete
    const allResults = await Promise.all(extractionPromises);

    // Return successful results first, up to targetCount
    const successfulResults = allResults.filter(r => r.fetchStatus === 'success');
    const failedResults = allResults.filter(r => r.fetchStatus === 'error');

    // Combine successful and failed results, prioritizing successful ones
    const enhancedResults = [
      ...successfulResults.slice(0, targetCount),
      ...failedResults.slice(0, Math.max(0, targetCount - successfulResults.length))
    ].slice(0, targetCount);

    console.log(`[EnhancedContentExtractor] Completed processing ${resultsToProcess.length} results, extracted ${successfulResults.length} successful/${failedResults.length} failed`);
    return enhancedResults;
  }

  private parseContent(html: string): string {
    const $ = cheerio.load(html);

    // Remove all script, style, and other non-content elements
    $('script, style, noscript, iframe, img, video, audio, canvas, svg, object, embed, applet').remove();

    // Remove specific non-content elements (less aggressive)
    $('nav, header, footer, .nav, .header, .footer, .sidebar, .cookie-notice, .privacy-notice, .search-box').remove();

    // Remove elements with strong ad/tracking indicators
    $('[class*="ad-"], [class*="ads-"], [class*="advertisement"]').remove();

    // Remove empty elements
    $('*').each(function () {
      const $this = $(this);
      if ($this.children().length === 0 && $this.text().trim() === '') {
        $this.remove();
      }
    });

    // Try to find the main content area first
    let mainContent = '';

    // Priority selectors for main content
    const contentSelectors = [
      'article',
      'main',
      '[role="main"]',
      '.content',
      '.post-content',
      '#main-content',
      '#content',
      'body' // Last resort
    ];

    for (const selector of contentSelectors) {
      const $content = $(selector).first();
      // ... (keep loop logic)
      if ($content.length > 0) {
        mainContent = $content.text().trim();
        if (mainContent.length > 50) { // Lower threshold
          // ...
          break;
        }
      }
    }

    // ...

    // Clean up the text
    const cleanedContent = this.cleanTextContent(mainContent);
    return cleanText(cleanedContent, this.maxContentLength);
  }

  private cleanTextContent(text: string): string {
    // Remove excessive whitespace
    text = text.replace(/\s+/g, ' ');

    // Remove image-related text and data URLs (using word boundaries)
    text = text.replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g, '');
    text = text.replace(/\b(click to enlarge|click for full size|view larger|download image)\b/gi, '');

    // Remove common non-content patterns (word boundaries)
    text = text.replace(/\b(cookie|privacy|terms|conditions|disclaimer|legal|copyright|all rights reserved)\b/gi, ''); // Be careful here too

    // Remove excessive line breaks
    text = text.replace(/\n\s*\n/g, '\n');
    return text.trim();
  }

  private getSpecificErrorMessage(error: unknown): string {
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNABORTED') {
        return 'Request timeout';
      }
      if (error.response?.status === 403) {
        return '403 Forbidden - Access denied';
      }
      if (error.response?.status === 404) {
        return '404 Not found';
      }
      if (error.message.includes('maxContentLength')) {
        return 'Content too long';
      }
      if (error.response?.status) {
        return `HTTP ${error.response.status}: ${error.message}`;
      }
      return `Network error: ${error.message}`;
    }

    return error instanceof Error ? error.message : 'Unknown error';
  }

  async closeAll(): Promise<void> {
    await this.browserPool.closeAll();
  }
}
