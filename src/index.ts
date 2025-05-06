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
            await this.page.waitForLoadState('networkidle');
            
            console.log('Successfully logged in to LinkedIn');
        } catch (error) {
            console.error('Error during login:', error);
            throw error;
        }
    }

    async searchPeople(keyword: string): Promise<SearchResult[]> {
        try {
            if (!this.page) throw new Error('Page not initialized');

            // Navigate to search page
            await this.page.goto(`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(keyword)}`);
            
            // Wait for search results to load
            await this.page.waitForSelector('.reusable-search__result-container');
            
            // Extract search results
            const results = await this.page.$$eval('.reusable-search__result-container', (elements) => {
                return elements.map(element => {
                    const nameElement = element.querySelector('.entity-result__title-text');
                    const titleElement = element.querySelector('.entity-result__primary-subtitle');
                    const locationElement = element.querySelector('.entity-result__secondary-subtitle');
                    
                    return {
                        name: nameElement ? nameElement.textContent?.trim() || '' : '',
                        title: titleElement ? titleElement.textContent?.trim() || '' : '',
                        location: locationElement ? locationElement.textContent?.trim() || '' : '',
                        profileUrl: nameElement?.querySelector('a')?.href || ''
                    };
                });
            });
            
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

// Example usage
async function main(): Promise<void> {
    const crawler = new LinkedInCrawler();
    
    try {
        await crawler.initialize();
        await crawler.login();
        
        // Example: Search for people with "Software Engineer" in their profile
        const results = await crawler.searchPeople('Software Engineer');
        console.log('Search Results:', results);
        
    } catch (error) {
        console.error('Error in main:', error);
    } finally {
        await crawler.close();
    }
}

main(); 
