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

// Maximum time to wait for the entire scraping process (in milliseconds)
const SCRAPING_TIMEOUT = 60000;

// Maximum number of concurrent pages to process
const MAX_CONCURRENT_PAGES = 5;

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

async function processBatch(
  page: any,
  items: LinkedInContact[],
  filePath: string,
  data: LinkedInContact[]
): Promise<void> {
  const promises = items.map(async (item) => {
    if (!item.company?.website) return;

    console.log(
      `Processing ${item.company.name} (${item.company.website})...`
    );

    try {
      const contactInfo = await Promise.race([
        extractContactInfo(page, item.company.website),
        new Promise<ContactInfo>((_, reject) =>
          setTimeout(
            () => reject(new Error('Scraping timeout')),
            SCRAPING_TIMEOUT
          )
        ),
      ]);

      // Only update and save if we got some data
      if (contactInfo.emails.length > 0 || contactInfo.phones.length > 0) {
        item.company.contactInfo = contactInfo;
        // Save progress only when we have actual data
        await safeWriteFile(filePath, data);
        console.log(
          `Updated ${filePath} with results for ${item.company.name}`
        );
      } else {
        console.log(
          `No contact info found for ${item.company.name}`
        );
      }
    } catch (error) {
      console.error(
        `Failed to process ${item.company.website}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      // Don't save empty contact info on errors
    }
  });

  await Promise.all(promises);
}

async function processJsonFile(filePath: string): Promise<void> {
  const browser = await chromium.launch();
  const pages = await Promise.all(
    Array(MAX_CONCURRENT_PAGES).fill(null).map(() => browser.newPage())
  );

  try {
    const json = await fs.readFile(filePath, 'utf-8');
    const data: LinkedInContact[] = JSON.parse(json);

    // Filter out items that already have contact info
    const itemsToProcess = data.filter(
      (item) => !item.company?.contactInfo && item.company?.website
    );

    // Process items in batches
    for (let i = 0; i < itemsToProcess.length; i += MAX_CONCURRENT_PAGES) {
      const batch = itemsToProcess.slice(i, i + MAX_CONCURRENT_PAGES);
      const pageIndex = i % MAX_CONCURRENT_PAGES;
      await processBatch(pages[pageIndex], batch, filePath, data);
      
      // Add a small delay between batches to be nice to servers
      if (i + MAX_CONCURRENT_PAGES < itemsToProcess.length) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    console.log(`Finished processing ${filePath}`);
  } catch (error) {
    console.error(
      `Error processing file ${filePath}:`,
      error instanceof Error ? error.message : String(error)
    );
  } finally {
    await browser.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Please provide a filename as a command line argument');
    console.error('Usage: ts-node contactScraper.ts <filename>');
    process.exit(1);
  }

  const filename = args[0];
  if (!filename.startsWith('contacts_') || !filename.endsWith('.json')) {
    console.error('Filename must start with "contacts_" and end with ".json"');
    process.exit(1);
  }

  console.log(`Processing ${filename}...`);
  await processJsonFile(filename);
}

// Mainline
if (require.main === module) {
  main().catch(console.error);
}
