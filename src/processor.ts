import fs from 'fs';
import path from 'path';
import type { LinkedInContact } from './types';

const getPhones = (contact: LinkedInContact) => {
  let phones = contact.company.contactInfo?.phones || [];
  phones = phones
    .map((phone) => {
      const cleanedPhone = phone.trim().replace(/\D/g, '');
      if (cleanedPhone.length === 10) {
        return cleanedPhone;
      }
      if (
        cleanedPhone.length === 11 &&
        (cleanedPhone.startsWith('0') || cleanedPhone.startsWith('1'))
      ) {
        return cleanedPhone.slice(1);
      }
      return undefined;
    })
    .filter((phone): phone is string => Boolean(phone))
    .filter((phone) => /^(800|866|216|440|330)/.test(phone))
    .map((phone) => {
      const parts = phone.match(/(\d{3})(\d{3})(\d{4})/);
      return parts ? `(${parts[1]}-${parts[2]}-${parts[3]})` : phone;
    });

  // Deduplicate phone numbers using Set
  const uniquePhones = [...new Set(phones)];
  return uniquePhones.join('  ').replace(/"/g, '');
};

const getEmails = (contact: LinkedInContact) => {
  return contact.company.contactInfo?.emails
    .filter(email => !email.toLowerCase().includes('wixpress'))
    .join(',')
    .replace(/"/g, '')
    .slice(0, 60);
};

class ContactProcessor {
  private readonly contactsDir: string;

  constructor() {
    this.contactsDir = path.join(process.cwd(), 'data', 'contacts');
  }

  async *gatherContacts(): AsyncGenerator<LinkedInContact> {
    // Read all files in the contacts directory
    const files = await fs.promises.readdir(this.contactsDir);
    // Filter for JSON files
    const jsonFiles = files
      .filter((file) => file.endsWith('.json'))
      .sort((a, b) => a.localeCompare(b));
    console.log(`Found ${jsonFiles.length} JSON files to process`);

    // Yield each contact within each JSON file
    for (const file of jsonFiles) {
      const filePath = path.join(this.contactsDir, file);
      const fileContent = await fs.promises.readFile(filePath, 'utf-8');
      const contacts: LinkedInContact[] = JSON.parse(fileContent);
      for (const contact of contacts) {
        yield contact;
      }
    }
  }

  async dictate(): Promise<void> {
    console.log('Dictating contact names:');

    let contactCount = 0;
    for await (const contact of this.gatherContacts()) {
      console.log(contact.page, contact.name, contact.company.name);
      contactCount++;
    }
    console.log(`\nTotal contacts processed: ${contactCount}`);
  }

  async exportToCsv(): Promise<void> {
    console.log('Exporting contacts to CSV');

    const csvPath = path.join(process.cwd(), 'data', 'contacts.csv');
    const csvHeader =
      'Name,Title,Company Name,Phones,E-mails,Company URL,Company Website,Location,Profile URL,Page,Crawled Date\n';

    // Create the CSV file with headers
    await fs.promises.writeFile(csvPath, csvHeader);

    let contactCount = 0;
    for await (const c of this.gatherContacts()) {
      const row =
        [
          `"${c.name.replace(/"/g, "'")}"`,
          `"${c.title.replace(/"/g, "'")}"`,
          `"${c.company.name.replace(/"/g, "'")}"`,
          `"${getPhones(c)}"`,
          `"${getEmails(c)}"`,
          `"${c.company.url.replace(/"/g, "'")}"`,
          `"${c.company.website.replace(/"/g, "'")}"`,
          `"${c.location.replace(/"/g, "'")}"`,
          `"${c.profileUrl.replace(/"/g, "'")}"`,
          c.page,
          c.crawledDateTime ? `"${c.crawledDateTime.join(';')}"` : '',
        ].join(',') + '\n';

      await fs.promises.appendFile(csvPath, row, { encoding: 'utf-8' });
      contactCount++;
    }

    console.log(`Exported ${contactCount} contacts to ${csvPath}`);
  }
}

// Example usage
async function main() {
  const processor = new ContactProcessor();
  await processor.exportToCsv();
}

if (require.main === module) {
  main();
}
