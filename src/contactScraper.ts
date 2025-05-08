import { chromium } from 'playwright';
import * as emailAddresses from 'email-addresses';
import fs from 'fs/promises';
import process from 'process';

interface ContactInfo {
  emails: string[];
  phones: string[];
}

interface Company {
  name: string;
  url: string;
  website: string;
  contactInfo?: ContactInfo;
}

interface LinkedInContact {
  name: string;
  title: string;
  company: Company;
  location: string;
  profileUrl: string;
  page: number;
  crawledDateTime?: string[];  // Array of ISO timestamps for each crawl
}

// Regular expression for phone numbers
const PHONE_REGEX =
  /(?:\+?(\d{1,3}))?[-. (]*(\d{3})[-. )]*(\d{3})[-. ]*(\d{4})(?: *x\d+)?/g;

// Simple email regex as fallback
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// Maximum time to wait for a page to load (in milliseconds)
const PAGE_LOAD_TIMEOUT = 30000;

// Maximum time to wait between retries (in milliseconds)
const RETRY_DELAY = 5000;

// Maximum number of retries per URL
const MAX_RETRIES = 2;

// Maximum number of concurrent pages to process
const MAX_CONCURRENT_PAGES = 5;

// Browser stealth configuration
const STEALTH_CONFIG = {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  isMobile: false,
  hasTouch: false,
  locale: 'en-US',
  timezoneId: 'America/New_York',
  permissions: ['geolocation'],
  extraHTTPHeaders: {
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'DNT': '1'
  }
};

// Simple mutex implementation
class Mutex {
  private locked = false;
  private queue: Array<() => void> = [];

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }

    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) next();
    } else {
      this.locked = false;
    }
  }
}

// Create a mutex for file operations
const fileMutex = new Mutex();

async function safeWriteFile(filePath: string, data: any): Promise<void> {
  await fileMutex.acquire();
  try {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
  } finally {
    fileMutex.release();
  }
}

// Helper function to get formatted timestamp
function getTimestamp(): string {
  return new Date().toISOString();
}

// Helper function for logging with timestamp
function logWithTimestamp(message: string): void {
  console.log(`[${getTimestamp()}] ${message}`);
}

async function extractContactInfo(
  page: any,
  url: string,
  retryCount = 0
): Promise<ContactInfo> {
  if (!url) {
    return { emails: [], phones: [] };
  }

  try {
    // Set a shorter timeout and don't wait for networkidle
    await Promise.race([
      page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: PAGE_LOAD_TIMEOUT,
      }),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error('Page load timeout')),
          PAGE_LOAD_TIMEOUT
        )
      ),
    ]);

    // Get the page content with a timeout
    const content = (await Promise.race([
      page.content(),
      new Promise<string>((_, reject) =>
        setTimeout(
          () => reject(new Error('Content extraction timeout')),
          PAGE_LOAD_TIMEOUT
        )
      ),
    ])) as string;

    // Extract emails using both methods
    let emails: string[] = [];

    try {
      // Try the email-addresses package first
      const emailMatches = emailAddresses.parseAddressList(content);
      if (emailMatches) {
        emails = emailMatches
          .map((match) => {
            if ('address' in match) {
              return match.address;
            }
            return null;
          })
          .filter((email): email is string => email !== null);
      }
    } catch (error) {
      console.log(
        `Email parsing error for ${url}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    // If no emails found, try the regex as fallback
    if (emails.length === 0) {
      try {
        const emailMatches = content.matchAll(EMAIL_REGEX);
        emails = Array.from(emailMatches)
          .map((match) => (match as RegExpMatchArray)[0])
          .filter((email) => email.length > 0);
      } catch (error) {
        console.log(
          `Regex email parsing error for ${url}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    // Remove duplicates
    emails = [...new Set(emails)];

    // Extract phone numbers
    let phones: string[] = [];
    try {
      const phoneMatches = content.matchAll(PHONE_REGEX);
      phones = Array.from(phoneMatches)
        .map((match) => match[0])
        .filter((phone) => phone.length >= 10); // Basic validation
    } catch (error) {
      console.log(
        `Phone parsing error for ${url}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    // Remove duplicates from phones
    const uniquePhones = [...new Set(phones)];

    return { emails, phones: uniquePhones };
  } catch (error) {
    console.error(
      `Error scraping ${url}:`,
      error instanceof Error ? error.message : String(error)
    );

    // Retry logic
    if (retryCount < MAX_RETRIES) {
      console.log(
        `Retrying ${url} (attempt ${retryCount + 1}/${MAX_RETRIES})...`
      );
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
      return extractContactInfo(page, url, retryCount + 1);
    }

    return { emails: [], phones: [] };
  }
}

async function processJsonFile(filePath: string): Promise<void> {
  const startTime = Date.now();
  logWithTimestamp(`Starting to process ${filePath}...`);

  const browser = await chromium.launch({
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-site-isolation-trials'
    ]
  });
  
  // Create a pool of pages with proper initialization
  const pagePool: any[] = [];
  for (let i = 0; i < MAX_CONCURRENT_PAGES; i++) {
    try {
      const page = await browser.newPage();
      
      // Apply stealth configuration
      await page.setExtraHTTPHeaders(STEALTH_CONFIG.extraHTTPHeaders);
      await page.setViewportSize(STEALTH_CONFIG.viewport);
      await page.addInitScript(`
        // Override navigator properties
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        
        // Add Chrome-specific properties
        window.chrome = {
          runtime: {},
          loadTimes: function() {},
          csi: function() {},
          app: {}
        };
      `);

      // Initialize the page by visiting a simple page first
      await page.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: PAGE_LOAD_TIMEOUT });
      pagePool.push(page);
    } catch (error) {
      logWithTimestamp(`Failed to initialize page ${i + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (pagePool.length === 0) {
    logWithTimestamp('Failed to initialize any pages. Exiting...');
    await browser.close();
    return;
  }

  logWithTimestamp(`Successfully initialized ${pagePool.length} pages`);

  try {
    const json = await fs.readFile(filePath, 'utf-8');
    const data: LinkedInContact[] = JSON.parse(json);

    // Filter out items that already have contact info
    const itemsToProcess = data.filter(
      (item) => !item.company?.contactInfo && item.company?.website
    );

    // Create a queue of items to process
    const queue = [...itemsToProcess];
    const mutex = new Mutex();

    // Function to process a single item
    const processItem = async (page: any, item: LinkedInContact): Promise<void> => {
      try {
        logWithTimestamp(`Starting to process ${item.company.name} (${item.company.website})...`);
        const contactInfo = await extractContactInfo(page, item.company.website);
        
        // Update the data with contact info
        await mutex.acquire();
        try {
          const index = data.findIndex(d => d === item);
          if (index !== -1) {
            data[index].company.contactInfo = contactInfo;
            // Initialize crawledDateTime array if it doesn't exist
            if (!data[index].crawledDateTime) {
              data[index].crawledDateTime = [];
            }
            // Add current timestamp
            data[index].crawledDateTime.push(getTimestamp());
            await safeWriteFile(filePath, data);
            logWithTimestamp(`Successfully processed ${item.company.name} - Found ${contactInfo.emails.length} emails and ${contactInfo.phones.length} phones`);
          }
        } finally {
          mutex.release();
        }
      } catch (error) {
        logWithTimestamp(`Error processing ${item.company.website}: ${error instanceof Error ? error.message : String(error)}`);
      }
    };

    // Function to get next item from queue
    const getNextItem = async (): Promise<LinkedInContact | null> => {
      await mutex.acquire();
      try {
        const item = queue.shift();
        if (item) {
          logWithTimestamp(`Queue status: ${queue.length} items remaining`);
        }
        return item || null;
      } finally {
        mutex.release();
      }
    };

    // Process items using the worker pool
    const processQueue = async (page: any, workerId: number): Promise<void> => {
      logWithTimestamp(`Worker ${workerId} started`);
      while (true) {
        const item = await getNextItem();
        if (!item) {
          logWithTimestamp(`Worker ${workerId} finished - no more items in queue`);
          break;
        }
        
        await processItem(page, item);
        // Add a small delay between requests to be nice to servers
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    };

    // Start all workers
    const workers = pagePool.map((page, index) => processQueue(page, index + 1));
    logWithTimestamp(`Starting ${workers.length} workers to process ${queue.length} items`);
    await Promise.all(workers);

    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000; // Convert to seconds
    logWithTimestamp(`Finished processing ${filePath} in ${duration.toFixed(2)} seconds`);
  } catch (error) {
    logWithTimestamp(`Error processing file ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    logWithTimestamp('Cleaning up browser resources...');
    try {
      // Close all pages first
      await Promise.all(pagePool.map(page => page.close().catch((e: Error) => 
        logWithTimestamp(`Error closing page: ${e.message}`)
      )));
      logWithTimestamp('All pages closed');
      
      // Then close the browser
      await browser.close();
      logWithTimestamp('Browser closed successfully');
    } catch (error) {
      logWithTimestamp(`Error during cleanup: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function main() {
  const startTime = Date.now();
  try {
    const args = process.argv.slice(2);
    if (args.length === 0) {
      logWithTimestamp('Please provide a filename as a command line argument');
      logWithTimestamp('Usage: ts-node contactScraper.ts <filename>');
      process.exit(1);
    }

    const filename = args[0];
    if (!filename.startsWith('contacts_') || !filename.endsWith('.json')) {
      logWithTimestamp('Filename must start with "contacts_" and end with ".json"');
      process.exit(1);
    }

    logWithTimestamp(`Processing ${filename}...`);
    await processJsonFile(filename);
    
    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000; // Convert to seconds
    logWithTimestamp(`Script completed successfully in ${duration.toFixed(2)} seconds`);
    
    // Force exit after a short delay to ensure cleanup is complete
    setTimeout(() => {
      logWithTimestamp('Forcing process exit.');
      process.exit(0);
    }, 1000);
  } catch (error) {
    logWithTimestamp(`Fatal error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

// Mainline
if (require.main === module) {
  main().catch((error) => {
    logWithTimestamp(`Unhandled error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
