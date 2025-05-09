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
    const jsonFiles = files.filter((file) => file.endsWith('.json'));
    console.log(`Found ${jsonFiles.length} JSON files to process`);

    // Yield each JSON file
    let processedCount = 0;
    for (const file of jsonFiles) {
      const filePath = path.join(this.contactsDir, file);
      const fileContent = await fs.promises.readFile(filePath, 'utf-8');
      const contact: LinkedInContact = JSON.parse(fileContent);
      yield contact;
      processedCount++;
      console.log(`Successfully processed ${file}`);
    }

    console.log(`Successfully processed ${processedCount} contacts`);
  }
}

// Example usage
async function main() {
  const processor = new ContactProcessor();
  let contactCount = 0;
  for await (const contact of processor.gatherContacts()) {
    contactCount++;
  }
  console.log(`Processing complete! Processed ${contactCount} contacts`);
}

if (require.main === module) {
  main();
}
