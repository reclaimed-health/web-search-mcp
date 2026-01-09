
import { EnhancedContentExtractor } from '../src/enhanced-content-extractor.js';
import * as fs from 'fs';

// Full list of unique citations extracted from database
const TARGET_URLS = [
    "https://assets.publishing.service.gov.uk/government/uploads/system/uploads/attachment_data/file/852382/Aqueous_cream_contains_sodium_lauryl_sulfate_which_may_cause_skin_reactions__particularly_in_children_with_eczema.pdf",
    "https://ec.europa.eu/health/scientific_committees/consumer_safety/docs/sccs_o_041.pdf",
    "https://echa.europa.eu/hot-topics/microplastics",
    "https://health.ec.europa.eu/publications/safety-aluminium-cosmetic-products_en",
    "https://health.ec.europa.eu/scientific-committees/scientific-committee-consumer-safety-sccs_en",
    "https://who.int/news-room/fact-sheets/detail/salt-reduction",
    "https://www.efsa.europa.eu",
    "https://www.efsa.europa.eu/en/efsajournal/pub/4567",
    "https://www.efsa.europa.eu/en/efsajournal/pub/5245",
    "https://www.efsa.europa.eu/en/news/efsa-assesses-safety-titanium-dioxide-e171",
    "https://www.efsa.europa.eu/en/press/news/170615",
    "https://www.efsa.europa.eu/en/press/news/process-contaminants-vegetable-oils-foods",
    "https://www.efsa.europa.eu/en/topics/topic/aspartame",
    "https://www.efsa.europa.eu/en/topics/topic/food-colours",
    "https://www.efsa.europa.eu/en/topics/topic/mycotoxins",
    "https://www.ewg.org/foodnews/",
    "https://www.fda.gov/animal-veterinary/outbreaks-and-advisories/fda-investigation-potential-link-between-certain-diets-and-canine-dilated-cardiomyopathy",
    "https://www.fda.gov/animal-veterinary/outbreaks-and-advisories/fda-investigation-potential-link-between-certain-diets-and-d canine-dilated-cardiomyopathy",
    "https://www.fda.gov/drugs/information-drug-class/benzalkonium-chloride-topical-antiseptic-products",
    "https://www.food.gov.uk",
    "https://www.food.gov.uk/safety-hygiene/food-allergens",
    "https://www.gov.uk/government/publications/caffeine-and-children",
    "https://www.health.harvard.edu/heart-health/the-sweet-danger-of-sugar",
    "https://www.mayoclinic.org/healthy-lifestyle/nutrition-and-healthy-eating/in-depth/caffeine/art-20045678",
    "https://www.nhs.uk/conditions/asthma/",
    "https://www.nhs.uk/conditions/food-allergies/",
    "https://www.nhs.uk/conditions/gestational-diabetes/diet/",
    "https://www.nhs.uk/conditions/high-blood-pressure-self-help/",
    "https://www.nhs.uk/conditions/type-2-diabetes/prevention/",
    "https://www.nhs.uk/live-well/eat-well/different-fats-nutrition/",
    "https://www.nhs.uk/live-well/eat-well/how-does-lactose-intolerance-affect-our-health/",
    "https://www.nhs.uk/live-well/eat-well/how-does-sugar-in-our-diet-affect-our-health/",
    "https://www.nhs.uk/mental-health/conditions/generalised-anxiety-disorder-gad/",
    "https://www.nice.org.uk/guidance/cg113",
    "https://www.nutrition.org.uk/healthyliving/find-your-balance/portionwise.html",
    "https://www.who.int/health-topics/cancer",
    "https://www.who.int/health-topics/gluten",
    "https://www.who.int/news-room/fact-sheets/detail/obesity-and-overweight",
    "https://www.who.int/news-room/fact-sheets/detail/salt-reduction"
];

async function runVerification() {
    console.log('🔍 Starting Comprehensive Citation Verification Run...');
    console.log(`🎯 Targets: ${TARGET_URLS.length} URLs`);

    const extractor = new EnhancedContentExtractor();
    const results: any[] = [];

    for (const url of TARGET_URLS) {
        // Skipping obviously broken URLs (with spaces)
        if (url.includes(' ')) {
            console.log(`⚠️ Skipping malformed URL: ${url}`);
            results.push({ url, status: 'SKIPPED', error: 'Malformed URL' });
            continue;
        }

        console.log(`\n-----------------------------------`);
        console.log(`Processing: ${url}`);
        const startTime = Date.now();

        try {
            const content = await extractor.extractContent({
                url,
                timeout: 30000 // Configured timeout
            });

            const duration = Date.now() - startTime;
            const success = content.length > 500; // Arbitrary min length

            console.log(`✅ Status: ${success ? 'SUCCESS' : 'WARNING (Low Content)'}`);
            console.log(`⏱️ Duration: ${duration}ms`);
            console.log(`📝 Length: ${content.length} chars`);

            results.push({ url, status: 'SUCCESS', duration, length: content.length, lowContent: !success });
        } catch (error) {
            const duration = Date.now() - startTime;
            console.error(`❌ Status: FAILED`);
            console.error(`⏱️ Duration: ${duration}ms`);
            console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);

            results.push({ url, status: 'FAILED', duration, error: error instanceof Error ? error.message : String(error) });
        }
    }

    console.log('\n===================================');
    console.log('📊 Verification Summary');
    console.log('===================================');

    const successCount = results.filter(r => r.status === 'SUCCESS').length;
    console.log(`Total: ${results.length}`);
    console.log(`Success: ${successCount}`);
    console.log(`Failed: ${results.length - successCount}`);

    const lowContentCount = results.filter(r => r.lowContent).length;
    console.log(`Low Content Warnings: ${lowContentCount}`);

    await extractor.closeAll();
}

runVerification().catch(console.error);
