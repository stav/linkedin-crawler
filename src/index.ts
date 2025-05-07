import { access } from 'fs/promises';
import path from 'path';

import dotenv from 'dotenv';

import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';

// Load environment variables
dotenv.config();

const STORAGE_STATE_PATH = path.join(process.cwd(), 'linkedin-state.json');

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

    // Set up console logging
    // this.page.on('console', msg => console.log('Browser console:', msg.text()));

    // Wait for the container to be available
    try {
      await this.page.waitForSelector('#search-results-container', { timeout: 10000 });
      // Additional wait to ensure content starts loading
      await this.page.waitForTimeout(2000);
    } catch (error) {
      console.log('Timeout waiting for search results container, continuing...');
    }

    // Function to check if there are any remaining placeholders
    const hasPlaceholders = async () => {
      return await this.page!.evaluate(() => {
        const searchResultsContainer = document.querySelector('#search-results-container');
        return searchResultsContainer ? searchResultsContainer.querySelectorAll('article[aria-hidden="true"]').length > 0 : false;
      });
    };

    // Function to get current number of loaded items
    const getLoadedItemsCount = async () => {
      return await this.page!.evaluate(() => {
        const container = document.querySelector('#search-results-container');
        if (!container) return 0;
        const items = container.querySelectorAll('li');
        return items.length;
      });
    };

    // Function to get number of actually loaded (non-placeholder) items
    const getLoadedNonPlaceholderCount = async () => {
      return await this.page!.evaluate(() => {
        const container = document.querySelector('#search-results-container');
        if (!container) return 0;
        const items = container.querySelectorAll('li');
        const loadedItems = Array.from(items).filter(item => {
          const nameElement = item.querySelector('.artdeco-entity-lockup__title span[data-anonymize="person-name"]');
          const isLoaded = nameElement && nameElement.textContent?.trim();
          console.log('Item debug:', {
            hasName: !!nameElement,
            isLoaded,
            name: nameElement?.textContent?.trim(),
          });
          return isLoaded;
        });
        return loadedItems.length;
      });
    };

    // Function to get container info for debugging
    const getContainerInfo = async () => {
      return await this.page!.evaluate(() => {
        const container = document.querySelector('#search-results-container');
        if (!container) return null;
        const items = container.querySelectorAll('li');
        const loadedItems = Array.from(items).filter(item => {
          const nameElement = item.querySelector('.artdeco-entity-lockup__title span[data-anonymize="person-name"]');
          const isLoaded = nameElement && nameElement.textContent?.trim();
          console.log('Container item debug:', {
            hasName: !!nameElement,
            isLoaded,
            name: nameElement?.textContent?.trim()
          });
          return isLoaded;
        });
        return {
          scrollHeight: container.scrollHeight,
          clientHeight: container.clientHeight,
          scrollTop: container.scrollTop,
          children: container.children.length,
          listItems: items.length,
          visibleItems: loadedItems.length,
          loadedItemsDetails: loadedItems.map(item => {
            const name = item.querySelector('.artdeco-entity-lockup__title span[data-anonymize="person-name"]')?.textContent?.trim();
            return { 
              name,
              hasName: !!name
            };
          })
        };
      });
    };

    console.log('Starting lazy content loading...');
    let previousLoadedCount = 0;
    let sameCountAttempts = 0;
    let scrollAttempts = 0;
    const maxScrollAttempts = 50;

    // First, let's get the container info
    const initialInfo = await getContainerInfo();
    console.log('Initial container info:', initialInfo);

    // Set up Intersection Observer to trigger lazy loading
    await this.page.evaluate(() => {
      const container = document.querySelector('#search-results-container') as HTMLElement;
      if (!container) return;

      // Create an Intersection Observer with more aggressive settings
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            // Force a reflow to trigger lazy loading
            const target = entry.target as HTMLElement;
            target.style.display = 'none';
            target.offsetHeight; // Force reflow
            target.style.display = '';
            
            // Additional trigger for lazy loading
            const event = new Event('scroll');
            container.dispatchEvent(event);
          }
        });
      }, {
        root: container,
        threshold: 0.1,
        rootMargin: '100px'
      });

      // Observe all list items
      const items = container.querySelectorAll('li');
      items.forEach(item => observer.observe(item));
    });

    while (scrollAttempts < maxScrollAttempts) {
      // Scroll the container in smaller increments with delays
      await this.page.evaluate(async () => {
        const container = document.querySelector('#search-results-container') as HTMLElement;
        if (!container) return;

        // Get the container's dimensions
        const scrollHeight = container.scrollHeight;
        const clientHeight = container.clientHeight;
        
        // Calculate scroll steps based on container height
        const step = clientHeight / 4; // Quarter of the visible height for more aggressive scrolling
        
        // Scroll through the container in smaller steps with delays
        for (let i = 0; i < scrollHeight; i += step) {
          container.scrollTop = i;
          // Force a reflow to trigger lazy loading
          container.offsetHeight;
          // Add a small delay between scrolls
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        
        // Scroll back to top
        container.scrollTop = 0;
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Scroll through again with a slight offset
        for (let i = 0; i < scrollHeight; i += step) {
          container.scrollTop = i + (step / 2);
          // Force a reflow to trigger lazy loading
          container.offsetHeight;
          // Add a small delay between scrolls
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        
        // Final scroll to bottom
        container.scrollTop = scrollHeight;
        await new Promise(resolve => setTimeout(resolve, 200));
      });

      // Wait for potential new content
      await this.page.waitForTimeout(1000);

      // Get updated container info
      const currentInfo = await getContainerInfo();
      console.log('Current container info:', currentInfo);

      // Check current counts
      const totalCount = await getLoadedItemsCount();
      const loadedCount = await getLoadedNonPlaceholderCount();
      console.log(`Total items: ${totalCount}, Loaded items: ${loadedCount}`);

      if (loadedCount === previousLoadedCount) {
        sameCountAttempts++;
        if (sameCountAttempts >= 5) {
          console.log('No new items loaded after multiple attempts, assuming all content is loaded');
          break;
        }
      } else {
        sameCountAttempts = 0;
        previousLoadedCount = loadedCount;
      }

      // Check if we still have placeholders
      const remainingPlaceholders = await hasPlaceholders();
      if (!remainingPlaceholders) {
        console.log('No more placeholders found');
        break;
      }

      scrollAttempts++;
    }

    // Final wait to ensure any last items are loaded
    await this.page.waitForTimeout(2000);
    
    // Log final counts and container info
    const finalTotalCount = await getLoadedItemsCount();
    const finalLoadedCount = await getLoadedNonPlaceholderCount();
    const finalInfo = await getContainerInfo();
    console.log('Final container info:', finalInfo);
    console.log(`Final counts - Total: ${finalTotalCount}, Loaded: ${finalLoadedCount}`);
  }

  async salesNavigator(
    searchId: string,
    startPage: number = 1,
    maxPages: number = 8
  ): Promise<SearchResult[]> {
    try {
      if (!this.page) throw new Error('Page not initialized');

      const allResults: SearchResult[] = [];
      let currentPage = startPage;

      while (currentPage <= maxPages) {
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
          console.log('Timeout waiting for search results to load, continuing.');
        }

        // Wait for lazy-loaded content
        console.log(`Waiting for lazy-loaded content on page ${currentPage}...`);
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
        console.log(`Loaded ${pageResults.length} results from page ${currentPage}`);

        // Check if we've reached the last page
        const hasNextPage = await this.page.evaluate(() => {
          const nextButton = document.querySelector('button[aria-label="Next"]');
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

async function main(): Promise<void> {
  const crawler = new LinkedInCrawler();

  try {
    await crawler.initialize();
    await crawler.login();

    const searchId = process.env.LINKEDIN_SEARCH_ID || '';
    const results = await crawler.salesNavigator(searchId, 1, 2); // Start from page 1, get up to 8 pages
    console.log('Results:', results);
  } catch (error) {
    console.error('Error in main:', error);
  } finally {
    await crawler.close();
  }
}

main();
