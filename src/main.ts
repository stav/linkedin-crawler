import dotenv from 'dotenv';
import { LinkedInCrawler } from './crawler';

dotenv.config();
const searchId = process.env.LINKEDIN_SEARCH_ID || '';

async function main(): Promise<void> {
  const crawler = new LinkedInCrawler();

  try {
    await crawler.initialize();
    await crawler.login();
    await crawler.salesNavigator(searchId, 3, 3);
    console.log('Total results found:', crawler.numResults);
  } catch (error) {
    console.error('Error in main:', error);
  } finally {
    await crawler.close();
  }
}

main();
