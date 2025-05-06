# LinkedIn Crawler

A Playwright-based crawler for LinkedIn that allows you to search for people and extract their profile information.

## Setup

1. Install dependencies:
```bash
bun install
```

2. Create a `.env` file in the root directory with your LinkedIn credentials:
```
LINKEDIN_EMAIL=your_email@example.com
LINKEDIN_PASSWORD=your_password
```

3. Install Playwright browsers:
```bash
bunx playwright install chromium
```

## Usage

Run the crawler:
```bash
bun start
```

The crawler will:
1. Launch a browser window
2. Log in to LinkedIn using your credentials
3. Search for people matching the specified keyword
4. Extract and display the search results

## Features

- Automated LinkedIn login
- People search functionality
- Profile information extraction
- Error handling and graceful cleanup

## Notes

- The crawler runs in non-headless mode by default so you can see what's happening
- Be mindful of LinkedIn's rate limits and terms of service
- Consider adding delays between actions to avoid being blocked 
