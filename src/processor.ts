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
    .filter((email) => !email.toLowerCase().includes('wixpress'))
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

    // prettier-ignore
    const fieldDefinitions = new Map<string, (c: LinkedInContact) => string>([
      ['Name'        , (c: LinkedInContact) => `"${c.name.replace(/"/g, "'")}"`],
      ['Title'       , (c: LinkedInContact) => `"${c.title.replace(/"/g, "'")}"`],
      ['Organization', (c: LinkedInContact) => `"${c.company.name.replace(/"/g, "'")}"`],
      ['Phones'      , (c: LinkedInContact) => `"${getPhones(c)}"`],
      ['E-mails'     , (c: LinkedInContact) => `"${getEmails(c)}"`],
      ['Location'    , (c: LinkedInContact) => `"${c.location.replace(/"/g, "'")}"`],
      ['Heads'       , (c: LinkedInContact) => ''],
      ['Stage'       , (c: LinkedInContact) => ''],
      ['Company URL' , (c: LinkedInContact) => `"${c.company.url.replace(/"/g, "'")}"`],
      ['Website'     , (c: LinkedInContact) => `"${c.company.website.replace(/"/g, "'")}"`],
      ['Page'        , (c: LinkedInContact) => String(c.page)],
    ]);

    const csvHeader = Array.from(fieldDefinitions.keys()).join(',') + '\n';

    // Create the CSV file with headers
    const csvPath = path.join(process.cwd(), 'data', 'contacts.csv');
    await fs.promises.writeFile(csvPath, csvHeader);

    let contactCount = 0;
    for await (const c of this.gatherContacts()) {
      const row =
        Array.from(fieldDefinitions.values())
          .map((renderFn) => renderFn(c))
          .join(',') + '\n';

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
