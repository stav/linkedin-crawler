import fs from 'fs';
import path from 'path';
import type { LinkedInContact } from './types';

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
      console.log(contact.page, contact.name);
      contactCount++;
    }
    console.log(`\nTotal contacts processed: ${contactCount}`);
  }
}

// Example usage
async function main() {
  const processor = new ContactProcessor();
  await processor.dictate();
}

if (require.main === module) {
  main();
}
