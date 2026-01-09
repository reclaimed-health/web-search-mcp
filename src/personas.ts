export interface Persona {
    name: string;
    userAgent: string;
    viewport: { width: number; height: number };
    platform: string;
    locale: string;
    timezoneId: string;
    deviceScaleFactor: number;
}

export const GOLDEN_PERSONAS: Persona[] = [
    {
        name: 'Windows 10 Chrome 121',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
        platform: 'Win32',
        locale: 'en-US',
        timezoneId: 'America/New_York',
        deviceScaleFactor: 1,
    },
    {
        name: 'Mac OS Chrome 121',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        viewport: { width: 1440, height: 900 },
        platform: 'MacIntel',
        locale: 'en-US',
        timezoneId: 'America/Los_Angeles',
        deviceScaleFactor: 2, // Retina display simulation
    },
    {
        name: 'Windows 11 Chrome 122',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        viewport: { width: 1366, height: 768 },
        platform: 'Win32',
        locale: 'en-GB',
        timezoneId: 'Europe/London',
        deviceScaleFactor: 1,
    },
    {
        name: 'Mac OS Chrome 122',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        viewport: { width: 1536, height: 960 },
        platform: 'MacIntel',
        locale: 'en-US', // Keep US English for consistency
        timezoneId: 'America/Chicago',
        deviceScaleFactor: 2,
    },
];

export function getRandomPersona(): Persona {
    const index = Math.floor(Math.random() * GOLDEN_PERSONAS.length);
    return GOLDEN_PERSONAS[index];
}
