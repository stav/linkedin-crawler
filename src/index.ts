import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

interface SearchResult {
  name: string;
  title: string;
  location: string;
  profileUrl: string;
}

class LinkedInCrawler {
  private browser: Browser | null;
  private context: BrowserContext | null;
  private page: Page | null;

  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
  }

  async initialize(): Promise<void> {
    this.browser = await chromium.launch({ headless: false });
    this.context = await this.browser.newContext();
    this.page = await this.context.newPage();
    console.log('Initialized browser');
  }

  async login(): Promise<void> {
    try {
      if (!this.page) throw new Error('Page not initialized');

      await this.page.goto('https://www.linkedin.com/login');

      // Wait for the login form to be visible
      await this.page.waitForSelector('#username');

      // Fill in the login form
      await this.page.fill('#username', process.env.LINKEDIN_EMAIL || '');
      await this.page.fill('#password', process.env.LINKEDIN_PASSWORD || '');

      // Click the login button
      await this.page.click('button[type="submit"]');

      // Wait for navigation after login
      try {
        await this.page.waitForLoadState('networkidle', { timeout: 10000 });
      } catch (error) {
        console.log('Timeout waiting for page load after login, continuing...');
      }

      console.log('Successfully logged in to LinkedIn');
    } catch (error) {
      console.error('Error during login:', error);
      throw error;
    }
  }

  async salesNavigator(
    searchId: string,
    page: number
  ): Promise<SearchResult[]> {
    try {
      if (!this.page) throw new Error('Page not initialized');

      // Navigate to search page
      const url = `https://www.linkedin.com/sales/search/people?page=${page}&savedSearchId=${searchId}`;

      console.log('Navigating to:', url);
      await this.page.goto(url);

      // Wait for search results to load
      try {
        await this.page.waitForSelector('#search-results-container', {
          timeout: 6000,
        });
      } catch (error) {
        console.log('Timeout waiting for search results to load, continuing.');
      }

      // Extract search results
      const results = await this.page.$$eval(
        '#search-results-container>.relative>ol>li',
        (elements) => {
          return elements.map((element) => {
            const nameElement = element;
            const titleElement = element.querySelector(
              '.artdeco-entity-lockup__title'
            );
            const locationElement = element.querySelector(
              '.artdeco-entity-lockup__caption'
            );

            return {
              name: nameElement ? nameElement.textContent?.trim() || '' : '',
              title: titleElement ? titleElement.textContent?.trim() || '' : '',
              location: locationElement
                ? locationElement.textContent?.trim() || ''
                : '',
              profileUrl: nameElement?.querySelector('a')?.href || '',
            };
          });
        }
      );

      return results;
    } catch (error) {
      console.error('Error during people search:', error);
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
    }
  }
}

async function main(): Promise<void> {
  const crawler = new LinkedInCrawler();

  try {
    await crawler.initialize();
    await crawler.login();

    const searchId = process.env.LINKEDIN_SEARCH_ID || '';
    const results = await crawler.salesNavigator(searchId, 2);
    console.log('Search Results:', results);
  } catch (error) {
    console.error('Error in main:', error);
  } finally {
    await crawler.close();
  }
}

main();
