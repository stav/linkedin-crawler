import fs from 'fs';
import path from 'path';

interface Contact {
    // We'll define the contact interface based on your JSON structure
    [key: string]: any;
}

class ContactProcessor {
    private readonly contactsDir: string;

    constructor() {
        this.contactsDir = path.join(process.cwd(), 'data', 'contacts');
    }

    async gatherContacts(): Promise<Contact[]> {
        try {
            // Read all files in the contacts directory
            const files = await fs.promises.readdir(this.contactsDir);
            
            // Filter for JSON files
            const jsonFiles = files.filter(file => file.endsWith('.json'));
            
            console.log(`Found ${jsonFiles.length} JSON files to process`);

            // Process each JSON file
            const contacts: Contact[] = [];
            for (const file of jsonFiles) {
                try {
                    const filePath = path.join(this.contactsDir, file);
                    const fileContent = await fs.promises.readFile(filePath, 'utf-8');
                    const contact = JSON.parse(fileContent);
                    contacts.push(contact);
                    console.log(`Successfully processed ${file}`);
                } catch (error) {
                    console.error(`Error processing file ${file}:`, error);
                }
            }

            console.log(`Successfully processed ${contacts.length} contacts`);
            return contacts;
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
        const contacts = await processor.gatherContacts();
        console.log('Processing complete!');
        // TODO: Add your database operations here
    } catch (error) {
        console.error('Failed to process contacts:', error);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}
