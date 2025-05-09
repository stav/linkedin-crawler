export interface ContactInfo {
  emails: string[];
  phones: string[];
}

export interface Company {
  name: string;
  url: string;
  website: string;
  contactInfo?: ContactInfo;
}

export interface LinkedInContact {
  name: string;
  title: string;
  company: Company;
  location: string;
  profileUrl: string;
  page: number;
  crawledDateTime?: string[];  // Array of ISO timestamps for each crawl
} 
