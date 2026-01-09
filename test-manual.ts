
import { SearchEngine } from './src/search-engine';
import { EnhancedContentExtractor } from './src/enhanced-content-extractor';
import { BrowserPool } from './src/browser-pool';

async function main() {
    console.log('Starting manual verification...');

    // 1. Test Search Engine
    const searchEngine = new SearchEngine();
    const query = "example domain";

    console.log(`Searching for: ${query}`);
    const searchResponse = await searchEngine.search({
        query,
        numResults: 3,
    });

    console.log(`Found ${searchResponse.results.length} results.`);
    searchResponse.results.forEach((r, i) => {
        console.log(`[${i + 1}] ${r.title} - ${r.url}`);
    });

    if (searchResponse.results.length === 0) {
        console.error('No results found!');
        process.exit(1);
    }

    // 2. Test Content Extraction (on the first result)
    const firstResult = searchResponse.results[0];
    if (firstResult) {
        console.log(`Extracting content from: ${firstResult.url}`);
        const extractor = new EnhancedContentExtractor();
        const content = await extractor.extractContent({
            url: firstResult.url,
            maxContentLength: 1000
        });
        console.log(`Extracted content length: ${content.length}`);
        console.log(`Preview: ${content.substring(0, 100)}...`);

        await extractor.closeAll();
    }

    // Cleanup
    await searchEngine.closeAll();

    console.log('Verification complete.');
}

main().catch(console.error);
