import fs from 'fs';
import path from 'path';
import type { LinkedInContact } from './types';

class ContactProcessor {
  private readonly contactsDir: string;

  constructor() {
    this.contactsDir = path.join(process.cwd(), 'data', 'contacts');
  }

  async *gatherContacts(): AsyncGenerator<LinkedInContact> {
    try {
      // Read all files in the contacts directory
      const files = await fs.promises.readdir(this.contactsDir);

      // Filter for JSON files
      const jsonFiles = files.filter((file) => file.endsWith('.json'));

      console.log(`Found ${jsonFiles.length} JSON files to process`);

      // Process each JSON file
      let processedCount = 0;
      for (const file of jsonFiles) {
        try {
          const filePath = path.join(this.contactsDir, file);
          const fileContent = await fs.promises.readFile(filePath, 'utf-8');
          const contact: LinkedInContact = JSON.parse(fileContent);
          yield contact;
          processedCount++;
          console.log(`Successfully processed ${file}`);
        } catch (error) {
          console.error(`Error processing file ${file}:`, error);
        }
      }

      console.log(`Successfully processed ${processedCount} contacts`);
    } catch (error) {
      console.error('Error reading contacts directory:', error);
      throw error;
    }
  }
}

// Example usage
async function main() {
  const processor = new ContactProcessor();
  try {
    let contactCount = 0;
    for await (const contact of processor.gatherContacts()) {
      contactCount++;
      // TODO: Add your database operations here
    }
    console.log(`Processing complete! Processed ${contactCount} contacts`);
  } catch (error) {
    console.error('Failed to process contacts:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
