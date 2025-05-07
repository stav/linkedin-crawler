import { writeFile } from 'fs/promises';
import type { SearchResult } from './crawler';

export async function writeSearchResultsToFile(
  results: SearchResult[],
  filePath: string
): Promise<void> {
  try {
    const data = JSON.stringify(results, null, 2);
    await writeFile(filePath, data, 'utf-8');
    console.log(`Results written to ${filePath}`);
  } catch (error) {
    console.error('Error writing results to file:', error);
    throw error;
  }
}

export function displaySearchResults(results: SearchResult[]): void {
  // Group results by page
  const resultsByPage = results.reduce((acc, result) => {
    if (!acc[result.page]) {
      acc[result.page] = [];
    }
    acc[result.page].push(result);
    return acc;
  }, {} as Record<number, SearchResult[]>);

  // Display results grouped by page
  console.log('\nSearch Results:');
  console.log('==============');
  Object.entries(resultsByPage).forEach(([page, pageResults]) => {
    console.log(`\nPage ${page} (${pageResults.length} results):`);
    console.log('-------------------');
    pageResults.forEach((result, index) => {
      console.log(`\n${index + 1}. ${result.name}`);
      console.log(`   Title: ${result.title}`);
      console.log(`   Location: ${result.location}`);
      console.log(`   Profile: ${result.profileUrl}`);
    });
  });
}
