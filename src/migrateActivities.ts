import Airtable from 'airtable';
import dotenv from 'dotenv';

dotenv.config();

// Initialize Airtable with Personal Access Token
const base = new Airtable({
  apiKey: process.env.AIRTABLE_PAT, // Personal Access Token instead of API Key
}).base(process.env.AIRTABLE_BASE_ID!);

async function migrateActivity() {
  try {
    // First verify we can access the tables
    console.log('Verifying table access');
    await base('Lawyers').select({ maxRecords: 1 }).firstPage();
    await base('Activity').select({ maxRecords: 1 }).firstPage();

    // Get all records from Lawyers table
    console.log('Fetching lawyers');
    const lawyers = await base('Lawyers')
      .select({
        fields: ['organization', 'Activity Date', 'Cold', 'Result', 'Notes'],
      })
      .all();

    console.log(`Found ${lawyers.length} lawyers to process`);

    // Process each lawyer
    let successCount = 0;
    let errorCount = 0;

    for (const lawyer of lawyers) {
      const activityDate = lawyer.get('Activity Date');
      const cold = lawyer.get('Cold');
      const result = lawyer.get('Result');
      const notes = lawyer.get('Notes');

      // Only create activity if there's activity data
      if (activityDate || cold || result || notes) {
        try {
          // Create new activity record
          await base('Activity').create({
            date: activityDate,
            cold,
            result,
            notes,
            Lawyers: [lawyer.id], // Link to the lawyer record
          });
          console.log(`✓ Created activity for ${lawyer.get('organization')}`);
          successCount++;
        } catch (error) {
          console.error(
            `✗ Error creating activity for ${lawyer.get('organization')}:`
          );
          console.error('Error details:', error);
          errorCount++;
        }
      }
    }

    console.log('\nMigration Summary:');
    console.log(`Total lawyers processed: ${lawyers.length}`);
    console.log(`Successful migrations: ${successCount}`);
    console.log(`Failed migrations: ${errorCount}`);
  } catch (error) {
    console.error('\nFatal error during migration:', error);
    process.exit(1);
  }
}

// Run the migration
migrateActivity();
