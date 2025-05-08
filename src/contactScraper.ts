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
const PHONE_REGEX = /(?:\+?(\d{1,3}))?[-. (]*(\d{3})[-. )]*(\d{3})[-. ]*(\d{4})(?: *x\d+)?/g;

// Simple email regex as fallback
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// Maximum time to wait for a page to load (in milliseconds)
const PAGE_LOAD_TIMEOUT = 10000;

// Maximum time to wait between retries (in milliseconds)
const RETRY_DELAY = 2000;

// Maximum number of retries per URL
const MAX_RETRIES = 2;

// Maximum time to wait for the entire scraping process (in milliseconds)
const SCRAPING_TIMEOUT = 30000;

async function extractContactInfo(url: string, retryCount = 0): Promise<ContactInfo> {
  if (!url) {
    return { emails: [], phones: [] };
  }

  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  try {
    // Set a shorter timeout and don't wait for networkidle
    await Promise.race([
      page.goto(url, { 
        waitUntil: 'domcontentloaded',
        timeout: PAGE_LOAD_TIMEOUT
      }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Page load timeout')), PAGE_LOAD_TIMEOUT)
      )
    ]);
    
    // Get the page content with a timeout
    const content = await Promise.race([
      page.content(),
      new Promise<string>((_, reject) => 
        setTimeout(() => reject(new Error('Content extraction timeout')), PAGE_LOAD_TIMEOUT)
      )
    ]) as string;
    
    // Extract emails using both methods
    let emails: string[] = [];
    
    try {
      // Try the email-addresses package first
      const emailMatches = emailAddresses.parseAddressList(content);
      if (emailMatches) {
        emails = emailMatches
          .map(match => {
            if ('address' in match) {
              return match.address;
            }
            return null;
          })
          .filter((email): email is string => email !== null);
      }
    } catch (error) {
      console.log(`Email parsing error for ${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    // If no emails found, try the regex as fallback
    if (emails.length === 0) {
      try {
        const emailMatches = content.matchAll(EMAIL_REGEX);
        emails = Array.from(emailMatches)
          .map(match => (match as RegExpMatchArray)[0])
          .filter(email => email.length > 0);
      } catch (error) {
        console.log(`Regex email parsing error for ${url}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    // Remove duplicates
    emails = [...new Set(emails)];
    
    // Extract phone numbers
    let phones: string[] = [];
    try {
      const phoneMatches = content.matchAll(PHONE_REGEX);
      phones = Array.from(phoneMatches)
        .map(match => match[0])
        .filter(phone => phone.length >= 10); // Basic validation
    } catch (error) {
      console.log(`Phone parsing error for ${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    // Remove duplicates from phones
    const uniquePhones = [...new Set(phones)];
    
    return { emails, phones: uniquePhones };
  } catch (error) {
    console.error(`Error scraping ${url}:`, error instanceof Error ? error.message : String(error));
    
    // Retry logic
    if (retryCount < MAX_RETRIES) {
      console.log(`Retrying ${url} (attempt ${retryCount + 1}/${MAX_RETRIES})...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      return extractContactInfo(url, retryCount + 1);
    }
    
    return { emails: [], phones: [] };
  } finally {
    try {
      await browser.close();
    } catch (error) {
      console.log(`Error closing browser for ${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function processJsonFile(filePath: string): Promise<void> {
  try {
    const json = await fs.readFile(filePath, 'utf-8');
    const data: LinkedInContact[] = JSON.parse(json);
    
    // Initialize the output file with the original data
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    console.log(`Created output file: ${filePath}`);
    
    for (const item of data) {
      if (item.company?.website) {
        console.log(`Processing ${item.company.name} (${item.company.website})...`);
        
        try {
          // Add timeout for the entire scraping process
          const contactInfo = await Promise.race([
            extractContactInfo(item.company.website),
            new Promise<ContactInfo>((_, reject) => 
              setTimeout(() => reject(new Error('Scraping timeout')), SCRAPING_TIMEOUT)
            )
          ]);
          
          // Add contact info to the item
          item.company.contactInfo = contactInfo;
          
          // Write the updated data after each website is processed
          await fs.writeFile(filePath, JSON.stringify(data, null, 2));
          console.log(`Updated ${filePath} with results for ${item.company.name}`);
        } catch (error) {
          console.error(`Failed to process ${item.company.website}: ${error instanceof Error ? error.message : String(error)}`);
          // Add empty contact info to indicate failure
          item.company.contactInfo = { emails: [], phones: [] };
          // Still write the file to maintain progress
          await fs.writeFile(filePath, JSON.stringify(data, null, 2));
        }
        
        // Add a small delay between requests to be nice to servers
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    console.log(`Finished processing ${filePath}`);
  } catch (error) {
    console.error(`Error processing file ${filePath}:`, error instanceof Error ? error.message : String(error));
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
