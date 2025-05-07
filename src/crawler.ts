import { access } from 'fs/promises';
import path from 'path';
import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';

const STORAGE_STATE_PATH = path.join(process.cwd(), 'linkedin-state.json');

export interface SearchResult {
  name: string;
  title: string;
  location: string;
  profileUrl: string;
}

export class LinkedInCrawler {
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

    // Try to load existing state if available
    try {
      await access(STORAGE_STATE_PATH);
      console.log('Loading existing session state...');
      this.context = await this.browser.newContext({
        storageState: STORAGE_STATE_PATH,
      });
    } catch {
      this.context = await this.browser.newContext();
    }

    this.page = await this.context.newPage();

    // Add console logging to the page
    // this.page.on('console', msg => console.log('Browser console:', msg.text()));

    console.log('Initialized browser');
  }

  async login(): Promise<void> {
    try {
      if (!this.page) throw new Error('Page not initialized');

      // Check if we're already logged in
      await this.page.goto('https://www.linkedin.com/feed/');
      const isLoggedIn = await this.page.evaluate(() => {
        return !document.querySelector('#username');
      });

      if (isLoggedIn) {
        console.log('Already logged in, skipping login process');
        return;
      }

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

      // Save the storage state after successful login
      if (this.context) {
        await this.context.storageState({ path: STORAGE_STATE_PATH });
        console.log('Session state saved successfully');
      }

      console.log('Successfully logged in to LinkedIn');
    } catch (error) {
      console.error('Error during login:', error);
      throw error;
    }
  }

  private async waitForLazyLoadedContent(): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');

    // Wait for the container to be available
    try {
      await this.page.waitForSelector('#search-results-container', { timeout: 10000 });
      await this.page.waitForTimeout(2000);
    } catch (error) {
      console.log('Timeout waiting for search results container, continuing...');
    }

    // Set up Intersection Observer to trigger lazy loading
    await this.page.evaluate(() => {
      const container = document.querySelector('#search-results-container') as HTMLElement;
      if (!container) return;

      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              const target = entry.target as HTMLElement;
              target.style.display = 'none';
              target.offsetHeight;
              target.style.display = '';
              container.dispatchEvent(new Event('scroll'));
            }
          });
        },
        { root: container, threshold: 0.1, rootMargin: '100px' }
      );

      container.querySelectorAll('li').forEach(item => observer.observe(item));
    });

    // Scroll through the container once
    await this.page.evaluate(async () => {
      const container = document.querySelector(
        '#search-results-container'
      ) as HTMLElement;
      if (!container) return;

      const step = container.clientHeight / 4;
      for (let i = 0; i < container.scrollHeight; i += step) {
        container.scrollTop = i;
        container.offsetHeight;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      container.scrollTop = container.scrollHeight;
    });

    await this.page.waitForTimeout(2000);
  }

  async salesNavigator(
    searchId: string,
    startPage: number = 1,
    endPage: number = 8
  ): Promise<SearchResult[]> {
    try {
      if (!this.page) throw new Error('Page not initialized');

      const allResults: SearchResult[] = [];
      let currentPage = startPage;

      while (currentPage <= endPage) {
        // Navigate to search page
        const url = `https://www.linkedin.com/sales/search/people?page=${currentPage}&savedSearchId=${searchId}`;

        console.log(`Navigating to page ${currentPage}:`, url);
        await this.page.goto(url);

        // Wait for search results to load
        try {
          await this.page.waitForSelector('#search-results-container', {
            timeout: 6000,
          });
        } catch (error) {
          console.log(
            'Timeout waiting for search results to load, continuing.'
          );
        }

        // Wait for lazy-loaded content
        console.log(
          `Waiting for lazy-loaded content on page ${currentPage}...`
        );
        await this.waitForLazyLoadedContent();

        // Extract search results from current page
        const pageResults = await this.page.$$eval(
          '#search-results-container > div.relative > ol > li',
          (elements) => {
            return elements
              .map((element) => {
                // Skip loading placeholders
                if (element.querySelector('article[aria-hidden="true"]')) {
                  return null;
                }

                const nameElement = element.querySelector(
                  '.artdeco-entity-lockup__title span[data-anonymize="person-name"]'
                );
                const titleElement = element.querySelector(
                  '.artdeco-entity-lockup__subtitle span[data-anonymize="title"]'
                );
                const companyElement = element.querySelector(
                  '.artdeco-entity-lockup__subtitle a[data-anonymize="company-name"]'
                );
                const locationElement = element.querySelector(
                  '.artdeco-entity-lockup__caption span[data-anonymize="location"]'
                );
                const linkElement = element.querySelector(
                  '.artdeco-entity-lockup__title a'
                ) as HTMLAnchorElement;

                // Get the text content and clean it up
                const name = nameElement
                  ? nameElement.textContent?.trim() || ''
                  : '';
                const title = titleElement
                  ? titleElement.textContent?.trim() || ''
                  : '';
                const company = companyElement
                  ? companyElement.textContent?.trim() || ''
                  : '';
                const location = locationElement
                  ? locationElement.textContent?.trim() || ''
                  : '';
                const profileUrl = linkElement?.href || '';

                return {
                  name,
                  title: `${title} at ${company}`.trim(),
                  location,
                  profileUrl,
                };
              })
              .filter((result) => result !== null); // Remove null entries
          }
        );

        // Add results from current page to all results
        allResults.push(...pageResults);
        console.log(
          `Loaded ${pageResults.length} results from page ${currentPage}`
        );

        // Check if we've reached the last page
        const hasNextPage = await this.page.evaluate(() => {
          const nextButton = document.querySelector(
            'button[aria-label="Next"]'
          );
          return nextButton && !nextButton.hasAttribute('disabled');
        });

        if (!hasNextPage) {
          console.log('Reached last page');
          break;
        }

        currentPage++;

        // Add a small delay between page loads to avoid rate limiting
        await this.page.waitForTimeout(1000);
      }

      console.log(`Total results collected: ${allResults.length}`);
      return allResults;
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
