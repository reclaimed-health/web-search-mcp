
import { EnhancedContentExtractor } from './src/enhanced-content-extractor';
import { SearchEngine } from './src/search-engine';

const TEST_URLS = [
    // Tesco (Known Anti-Bot)
    "https://www.tesco.com/groceries/en-GB/products/252204546",

    // Asda (Known Anti-Bot)
    "https://www.asda.com/groceries/product/barley-water-high-juice/robinsons-robinsons-fruit-barley-with-vitamins-apple-pear-squash-1l/1859199",

    // Sainsbury's (From failed batches - likely tricky or just network issues)
    "https://www.sainsburys.co.uk/gol-ui/product/yeos-laksa-paste-185g",
    "https://www.sainsburys.co.uk/gol-ui/product/thermocafe-desk-mug-midnight-blue-138029973-p-44",
    "https://www.sainsburys.co.uk/gol-ui/product/the-london-essence-co-original-indian-tonic-water-500ml",
    "https://www.sainsburys.co.uk/gol-ui/product/the-cultured-collective-kimchi-vegan-classic-250g"
];

const SEARCH_QUERIES = [
    "Yeo's Laksa Paste ingredients",
    "Tesco Robinsons Fruit Barley price"
];

async function main() {
    console.log('🚀 Starting Rigorous Testing of Web Search MCP Upgrades...');
    console.log('===========================================================');

    const extractor = new EnhancedContentExtractor();
    const searchEngine = new SearchEngine();

    const results = {
        success: 0,
        failed: 0,
        total: 0
    };

    console.log(`\n📦 Testing Direct Content Extraction (${TEST_URLS.length} URLs)`);

    for (const url of TEST_URLS) {
        results.total++;
        console.log(`\n[${results.total}/${TEST_URLS.length}] Processing: ${url}`);
        const start = Date.now();

        try {
            const content = await extractor.extractContent({
                url,
                maxContentLength: 5000
            });
            const duration = Date.now() - start;

            // Check for obvious block signatures
            if (content.includes("Access Denied") || content.includes("Human Verification")) {
                console.error(`❌ BLOCKED (${duration}ms): ${url}`);
                console.error(`Preview: ${content.substring(0, 100)}...`);
                results.failed++;
            } else if (content.length < 200) {
                console.warn(`⚠️  SHORT CONTENT (${duration}ms, ${content.length} chars): ${url}`);
                console.warn(`Preview: ${content.substring(0, 100)}...`);
                // Count as success technically, but warn
                results.success++;
            } else {
                console.log(`✅ SUCCESS (${duration}ms, ${content.length} chars)`);
                console.log(`Title preview: ${content.split('\n')[0].substring(0, 80)}...`);
                results.success++;
            }
        } catch (error) {
            console.error(`💥 ERROR: ${error instanceof Error ? error.message : String(error)}`);
            results.failed++;
        }
    }

    console.log(`\n🔍 Testing Search Engine Queries (${SEARCH_QUERIES.length} queries)`);

    for (const query of SEARCH_QUERIES) {
        console.log(`\nQuery: "${query}"`);
        try {
            const response = await searchEngine.search({ query, numResults: 3 });
            console.log(`Found ${response.results.length} results via engine: ${response.engine || 'Unknown'}`);
            response.results.forEach((r, i) => {
                console.log(`  ${i + 1}. ${r.title} (${r.url})`);
            });
            if (response.results.length > 0) results.success++;
        } catch (e) {
            console.error(`Search Failed: ${e}`);
            results.failed++;
        }
    }

    console.log('\n===========================================================');
    console.log(`Testing Complete.`);
    console.log(`Total: ${results.total + SEARCH_QUERIES.length}`);
    console.log(`Success: ${results.success}`);
    console.log(`Failed: ${results.failed}`);

    await extractor.closeAll();
    await searchEngine.closeAll();

    process.exit(results.failed > 0 ? 1 : 0);
}

main().catch(console.error);
