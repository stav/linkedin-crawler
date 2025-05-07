import dotenv from 'dotenv';
import { LinkedInCrawler } from './crawler';

dotenv.config();
const searchId = process.env.LINKEDIN_SEARCH_ID || '';

async function main(): Promise<void> {
  const crawler = new LinkedInCrawler();

  try {
    await crawler.initialize();
    await crawler.login();
    const results = await crawler.salesNavigator(searchId, 1, 1);
    console.log('Results:', results);
  } catch (error) {
    console.error('Error in main:', error);
  } finally {
    await crawler.close();
  }
}

main();
