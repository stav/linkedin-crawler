import dotenv from 'dotenv';
import { LinkedInCrawler } from './crawler';

dotenv.config();
const searchId = process.env.LINKEDIN_SEARCH_ID || '';

async function main(): Promise<void> {
  const crawler = new LinkedInCrawler();
  
  // Parse command line arguments for page numbers
  const args = process.argv.slice(2);
  let fromPage = 1;
  let toPage = 1;

  if (args.length === 1) {
    // If only one number is provided, crawl just that page
    fromPage = parseInt(args[0], 10);
    toPage = fromPage;
  } else if (args.length >= 2) {
    // If two numbers are provided, crawl the range
    fromPage = parseInt(args[0], 10);
    toPage = parseInt(args[1], 10);
  }
  // If no arguments are provided, default to page 1 (fromPage and toPage are already 1)

  console.log(`Starting crawl from page ${fromPage} to page ${toPage}`);

  try {
    await crawler.initialize();
    await crawler.login();
    await crawler.salesNavigator(searchId, fromPage, toPage);
    console.log('Total results found:', crawler.numResults);
  } catch (error) {
    console.error('Error in main:', error);
  } finally {
    await crawler.close();
  }
}

main();
