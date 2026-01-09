import axios from 'axios';
import * as cheerio from 'cheerio';
import { SearchOptions, SearchResult, SearchResultWithMetadata } from './types.js';
import { generateTimestamp, sanitizeQuery } from './utils.js';
import { RateLimiter } from './rate-limiter.js';
import { BrowserPool } from './browser-pool.js';
import { getRandomPersona } from './personas.js';

export class SearchEngine {
  private readonly rateLimiter: RateLimiter;
  private browserPool: BrowserPool;

  constructor() {
    this.rateLimiter = new RateLimiter(10); // 10 requests per minute
    this.browserPool = new BrowserPool();
  }

  async search(options: SearchOptions): Promise<SearchResultWithMetadata> {
    const { query, numResults = 5, timeout = 10000 } = options;
    const sanitizedQuery = sanitizeQuery(query);

    console.log(`[SearchEngine] Starting search for query: "${sanitizedQuery}"`);

    try {
      return await this.rateLimiter.execute(async () => {
        console.log(`[SearchEngine] Starting search with multiple engines...`);

        // Configuration from environment variables
        const enableQualityCheck = process.env.ENABLE_RELEVANCE_CHECKING !== 'false';
        const qualityThreshold = parseFloat(process.env.RELEVANCE_THRESHOLD || '0.3');
        const forceMultiEngine = process.env.FORCE_MULTI_ENGINE_SEARCH === 'true';
        const debugBrowsers = process.env.DEBUG_BROWSER_LIFECYCLE === 'true';

        console.log(`[SearchEngine] Quality checking: ${enableQualityCheck}, threshold: ${qualityThreshold}, multi-engine: ${forceMultiEngine}, debug: ${debugBrowsers}`);

        // Try multiple approaches to get search results, starting with most reliable
        const approaches = [
          { method: this.tryBrowserDuckDuckGoSearch.bind(this), name: 'Browser DuckDuckGo' },
          { method: this.tryBrowserBingSearch.bind(this), name: 'Browser Bing' },
          { method: this.tryBrowserBraveSearch.bind(this), name: 'Browser Brave' },
          { method: this.tryDuckDuckGoSearch.bind(this), name: 'Axios DuckDuckGo' }
        ];

        let bestResults: SearchResult[] = [];
        let bestEngine = 'None';
        let bestQuality = 0;

        for (let i = 0; i < approaches.length; i++) {
          const approach = approaches[i];
          try {
            console.log(`[SearchEngine] Attempting ${approach.name} (${i + 1}/${approaches.length})...`);

            // Use more aggressive timeouts for faster fallback
            const approachTimeout = Math.min(timeout / 3, 5000); // 5s timeout per approach
            const results = await approach.method(sanitizedQuery, numResults, approachTimeout);
            if (results.length > 0) {
              console.log(`[SearchEngine] Found ${results.length} results with ${approach.name}`);

              // Validate result quality to detect irrelevant results
              const qualityScore = enableQualityCheck ? this.assessResultQuality(results, sanitizedQuery) : 1.0;
              console.log(`[SearchEngine] ${approach.name} quality score: ${qualityScore.toFixed(2)}/1.0`);

              // Track the best results so far
              if (qualityScore > bestQuality) {
                bestResults = results;
                bestEngine = approach.name;
                bestQuality = qualityScore;
              }

              // If quality is excellent, return immediately (unless forcing multi-engine)
              if (qualityScore >= 0.8 && !forceMultiEngine) {
                console.log(`[SearchEngine] Excellent quality results from ${approach.name}, returning immediately`);
                return { results, engine: approach.name };
              }

              // If quality is acceptable and this isn't Bing (first engine), return
              if (qualityScore >= qualityThreshold && approach.name !== 'Browser Bing' && !forceMultiEngine) {
                console.log(`[SearchEngine] Good quality results from ${approach.name}, using as primary`);
                return { results, engine: approach.name };
              }

              // If this is the last engine or quality is acceptable, prepare to return
              if (i === approaches.length - 1) {
                if (bestQuality >= qualityThreshold || !enableQualityCheck) {
                  console.log(`[SearchEngine] Using best results from ${bestEngine} (quality: ${bestQuality.toFixed(2)})`);
                  return { results: bestResults, engine: bestEngine };
                } else if (bestResults.length > 0) {
                  console.log(`[SearchEngine] Warning: Low quality results from all engines, using best available from ${bestEngine}`);
                  return { results: bestResults, engine: bestEngine };
                }
              } else {
                console.log(`[SearchEngine] ${approach.name} results quality: ${qualityScore.toFixed(2)}, continuing to try other engines...`);
              }
            }
          } catch (error) {
            console.error(`[SearchEngine] ${approach.name} approach failed:`, error);
          }
        }

        console.log(`[SearchEngine] All approaches failed, returning empty results`);
        return { results: [], engine: 'None' };
      });
    } catch (error) {
      console.error('[SearchEngine] Search error:', error);
      if (axios.isAxiosError(error)) {
        console.error('[SearchEngine] Axios error details:', {
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data?.substring(0, 500),
        });
      }
      throw new Error(`Failed to perform search: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async tryBrowserDuckDuckGoSearch(query: string, numResults: number, timeout: number): Promise<SearchResult[]> {
    console.log(`[SearchEngine] Trying browser-based DuckDuckGo search with shared pool...`);

    const persona = getRandomPersona();
    const context = await this.browserPool.getContext(persona);

    try {
      const page = await context.newPage();

      // DDG Search URL
      const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}&t=h_&ia=web`;
      console.log(`[SearchEngine] Browser navigating to DuckDuckGo: ${searchUrl}`);

      await page.goto(searchUrl, {
        waitUntil: 'domcontentloaded',
        timeout: timeout
      });

      // Wait for search results
      try {
        await page.waitForSelector('.react-results--main', { timeout: 3000 });
      } catch {
        console.log(`[SearchEngine] DDG react-results not found, checking for legacy...`);
        try {
          await page.waitForSelector('#links', { timeout: 2000 });
        } catch {
          console.log(`[SearchEngine] DDG legacy selectors not found`);
        }
      }

      const html = await page.content();
      const results = this.parseDuckDuckGoBrowserResults(html, numResults);

      await context.close();
      return results;
    } catch (error) {
      try { await context.close(); } catch { }
      console.error(`[SearchEngine] Browser DuckDuckGo search failed:`, error);
      throw error;
    }
  }

  private async tryBrowserBraveSearch(query: string, numResults: number, timeout: number): Promise<SearchResult[]> {
    console.log(`[SearchEngine] Trying browser-based Brave search with shared pool...`);

    const persona = getRandomPersona();
    const context = await this.browserPool.getContext(persona);

    try {
      const page = await context.newPage();

      // Navigate to Brave search
      const searchUrl = `https://search.brave.com/search?q=${encodeURIComponent(query)}&source=web`;
      console.log(`[SearchEngine] Browser navigating to Brave: ${searchUrl}`);

      await page.goto(searchUrl, {
        waitUntil: 'domcontentloaded',
        timeout: timeout
      });

      // Wait for search results to load
      try {
        await page.waitForSelector('[data-type="web"]', { timeout: 3000 });
      } catch {
        console.log(`[SearchEngine] Browser Brave results selector not found, proceeding anyway`);
      }

      // Get the page content
      const html = await page.content();

      console.log(`[SearchEngine] Browser Brave got HTML with length: ${html.length}`);

      const results = this.parseBraveResults(html, numResults);
      console.log(`[SearchEngine] Browser Brave parsed ${results.length} results`);

      await context.close();
      return results;
    } catch (error) {
      // Ensure context is closed even on error
      try { await context.close(); } catch { }
      console.error(`[SearchEngine] Browser Brave search failed:`, error);
      throw error;
    }
  }

  private async tryBrowserBingSearch(query: string, numResults: number, timeout: number): Promise<SearchResult[]> {
    console.log(`[SearchEngine] Trying browser-based Bing search with shared pool...`);

    const persona = getRandomPersona();
    const context = await this.browserPool.getContext(persona);

    try {
      const page = await context.newPage();

      // Bing "Clean" search URL
      const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${Math.min(numResults, 10)}`;
      console.log(`[SearchEngine] Browser navigating to Bing: ${searchUrl}`);

      await page.goto(searchUrl, {
        waitUntil: 'domcontentloaded',
        timeout: timeout
      });

      // Wait for search results to load
      try {
        await page.waitForSelector('.b_algo, .b_result', { timeout: 3000 });
      } catch {
        const title = await page.title();
        console.log(`[SearchEngine] Browser Bing results selector not found. Page title: "${title}"`);

        // Dump HTML for debugging
        try {
          const fs = await import('fs/promises');
          await fs.writeFile('bing-error.html', await page.content());
          console.log(`[SearchEngine] Dumped failed page content to bing-error.html`);
        } catch (e) {
          console.error('Failed to dump error HTML', e);
        }
      }

      const html = await page.content();
      const results = this.parseBingResults(html, numResults);

      await context.close();
      return results;
    } catch (error) {
      try { await context.close(); } catch { }
      console.error(`[SearchEngine] Browser Bing search failed:`, error);
      throw error;
    }
  }

  private async tryDuckDuckGoSearch(query: string, numResults: number, timeout: number): Promise<SearchResult[]> {
    console.log(`[SearchEngine] Trying DuckDuckGo as fallback...`);

    try {
      const persona = getRandomPersona();
      const response = await axios.get('https://html.duckduckgo.com/html/', {
        params: {
          q: query,
        },
        headers: {
          'User-Agent': persona.userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': persona.locale + ',en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          'DNT': '1',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
        },
        timeout,
        validateStatus: (status: number) => status < 400,
      });

      console.log(`[SearchEngine] DuckDuckGo got response with status: ${response.status}`);

      const results = this.parseDuckDuckGoResults(response.data, numResults);
      console.log(`[SearchEngine] DuckDuckGo parsed ${results.length} results`);

      return results;
    } catch {
      console.error(`[SearchEngine] DuckDuckGo search failed`);
      throw new Error('DuckDuckGo search failed');
    }
  }

  private assessResultQuality(results: SearchResult[], query: string): number {
    if (results.length === 0) return 0;

    // Simple heuristic: do the titles contain words from the query?
    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    if (queryWords.length === 0) return 1.0; // Too short to judge

    let matchCount = 0;
    results.forEach(result => {
      const titleLower = result.title.toLowerCase();
      const descLower = result.description.toLowerCase();

      const matches = queryWords.some(word => titleLower.includes(word) || descLower.includes(word));
      if (matches) matchCount++;
    });

    return matchCount / results.length;
  }

  // --- Parsing Helpers ---

  private parseBraveResults(html: string, maxResults: number): SearchResult[] {
    const $ = cheerio.load(html);
    const results: SearchResult[] = [];
    const timestamp = generateTimestamp();

    $('#results .snippet[data-type="web"]').each((_, element) => {
      if (results.length >= maxResults) return;
      const $el = $(element);
      const title = $el.find('.title').text().trim();
      const url = $el.find('a').attr('href');
      const description = $el.find('.snippet-content').text().trim();

      if (title && url) {
        results.push({
          title,
          url: url,
          description: description || '',
          fullContent: '',
          contentPreview: '',
          wordCount: 0,
          timestamp,
          fetchStatus: 'success'
        });
      }
    });

    // Fallback parsing if specific structure changed
    if (results.length === 0) {
      $('.snippet').each((_, element) => {
        if (results.length >= maxResults) return;
        const $el = $(element);
        const title = $el.find('a').first().text().trim();
        const url = $el.find('a').first().attr('href');

        if (title && url) {
          results.push({ title, url, description: '', fullContent: '', contentPreview: '', wordCount: 0, timestamp, fetchStatus: 'success' });
        }
      });
    }

    return results;
  }

  private parseBingResults(html: string, maxResults: number): SearchResult[] {
    const $ = cheerio.load(html);
    const results: SearchResult[] = [];
    const timestamp = generateTimestamp();

    $('.b_algo').each((_, element) => {
      if (results.length >= maxResults) return;
      const $el = $(element);
      const title = $el.find('h2').text().trim();
      const url = $el.find('h2 a').attr('href');
      const description = $el.find('.b_caption p').text().trim();

      if (title && url) {
        results.push({
          title,
          url,
          description,
          fullContent: '',
          contentPreview: '',
          wordCount: 0,
          timestamp,
          fetchStatus: 'success',
        });
      }
    });

    return results;
  }

  private parseDuckDuckGoResults(html: string, maxResults: number): SearchResult[] {
    const $ = cheerio.load(html);
    const results: SearchResult[] = [];
    const timestamp = generateTimestamp();

    $('.result').each((_, element) => {
      if (results.length >= maxResults) return;
      const $el = $(element);
      const title = $el.find('.result__title').text().trim();
      const url = $el.find('.result__url').attr('href');
      const description = $el.find('.result__snippet').text().trim();

      if (title && url) {
        // DDG URLs often are redirects or relative, need to be careful
        // The HTML version usually gives direct links but maybe with a "uddg=" param
        let cleanUrl = url;
        try {
          const urlObj = new URL(url, 'https://duckduckgo.com');
          if (urlObj.searchParams.has('uddg')) {
            cleanUrl = decodeURIComponent(urlObj.searchParams.get('uddg') || url);
          }
        } catch { }

        results.push({
          title,
          url: cleanUrl,
          description,
          fullContent: '',
          contentPreview: '',
          wordCount: 0,
          timestamp,
          fetchStatus: 'success',
        });
      }
    });

    return results;
  }

  private parseDuckDuckGoBrowserResults(html: string, maxResults: number): SearchResult[] {
    const $ = cheerio.load(html);
    const results: SearchResult[] = [];
    const timestamp = generateTimestamp();

    // Browser version of DDG (React based)
    // Selectors for React DDG
    $('article').each((_, element) => {
      if (results.length >= maxResults) return;
      const $el = $(element);
      const title = $el.find('h2 a').text().trim();
      const url = $el.find('h2 a').attr('href');
      const description = $el.find('[data-result="snippet"]').text().trim();

      if (title && url) {
        results.push({ title, url, description, fullContent: '', contentPreview: '', wordCount: 0, timestamp, fetchStatus: 'success' });
      }
    });

    // Fallback if structure is different (legacy)
    if (results.length === 0) {
      $('.result').each((_, element) => {
        if (results.length >= maxResults) return;
        const $el = $(element);
        const title = $el.find('.result__title').text().trim();
        const url = $el.find('.result__url').attr('href');
        const description = $el.find('.result__snippet').text().trim();

        if (title && url) {
          results.push({ title, url, description, fullContent: '', contentPreview: '', wordCount: 0, timestamp, fetchStatus: 'success' });
        }
      });
    }

    return results;
  }

  async closeAll(): Promise<void> {
    await this.browserPool.closeAll();
  }
}
