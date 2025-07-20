import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer';

export interface ScreenshotOptions {
  width?: number;
  height?: number;
  quality?: number;
  format?: 'png' | 'jpeg';
  fullPage?: boolean;
  timeout?: number;
}

export interface ScreenshotResult {
  url: string;
  filename: string;
  path: string;
  size: number;
  width: number;
  height: number;
}

export class ScreenshotService {
  private browser: Browser | null = null;
  private uploadsDir: string;

  constructor(uploadsDir?: string) {
    this.uploadsDir = uploadsDir || '/data';
  }

  async takeScreenshot(
    url: string,
    userId: string,
    options: ScreenshotOptions = {}
  ): Promise<ScreenshotResult> {
    const {
      width = 1200,
      height = 800,
      quality = 85,
      format = 'jpeg',
      fullPage = false,
      timeout = 30_000,
    } = options;

    let page: Page | null = null;

    try {
      // Initialize browser if not already done
      if (!this.browser) {
        await this.initializeBrowser();
      }

      if (!this.browser) {
        throw new Error('Failed to initialize browser');
      }

      // Create new page
      page = await this.browser.newPage();

      // Set viewport
      await page.setViewport({ width, height });

      // Set user agent
      await page.setUserAgent(
        'Mozilla/5.0 (compatible; Teak/1.0; +https://teak.app)'
      );

      // Navigate to URL with timeout
      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout,
      });

      // Wait for additional content to load (images, fonts, etc.)
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Try to wait for common loading indicators to disappear
      try {
        await page
          .waitForFunction(
            () => {
              // Check if common loading indicators are gone
              const loadingSelectors = [
                '[class*="loading"]',
                '[class*="spinner"]',
                '[class*="loader"]',
                '.loading',
                '.spinner',
                '.loader',
              ];

              for (const selector of loadingSelectors) {
                const element = document.querySelector(selector);
                if (element && element.offsetParent !== null) {
                  return false; // Still loading
                }
              }
              return true; // No loading indicators visible
            },
            { timeout: 5000 }
          )
          .catch(() => {
            // Ignore timeout - just means no loading indicators were found
          });
      } catch (error) {
        // Ignore errors - this is just a best-effort attempt
      }

      // Wait for images to load
      try {
        await page
          .waitForFunction(
            () => {
              const images = Array.from(document.querySelectorAll('img'));
              return images.every(
                (img) => img.complete || img.naturalWidth > 0
              );
            },
            { timeout: 8000 }
          )
          .catch(() => {
            // Ignore timeout - proceed anyway
          });
      } catch (error) {
        // Ignore errors
      }

      // Scroll to trigger lazy-loaded content
      try {
        await page.evaluate(() => {
          window.scrollTo(0, document.body.scrollHeight / 2);
        });
        await new Promise((resolve) => setTimeout(resolve, 500));
        await page.evaluate(() => {
          window.scrollTo(0, 0);
        });
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (error) {
        // Ignore errors
      }

      // Final wait for any remaining dynamic content
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Take screenshot
      const screenshotOptions = {
        type: format as 'png' | 'jpeg',
        quality: format === 'jpeg' ? quality : undefined,
        fullPage,
      };

      const screenshotBuffer = await page.screenshot(screenshotOptions);
      const uint8Array = new Uint8Array(screenshotBuffer);

      // Generate file info
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(2, 8);
      const filename = `screenshot-${timestamp}-${random}.${format}`;
      const datePath = this.createDatePath(userId);
      const relativePath = path.join(datePath, filename);
      const fullPath = path.join(this.uploadsDir, relativePath);
      const dirPath = path.dirname(fullPath);

      // Ensure directory exists
      if (!existsSync(dirPath)) {
        await mkdir(dirPath, { recursive: true });
      }

      // Write file
      await writeFile(fullPath, uint8Array);

      // Generate URL (using same pattern as file upload service)
      const fileUrl = `/api/data/${relativePath}`;

      return {
        url: fileUrl,
        filename,
        path: relativePath,
        size: uint8Array.length,
        width,
        height,
      };
    } catch (error) {
      console.error('Screenshot failed:', error);
      throw new Error(
        `Failed to take screenshot: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      // Close the page
      if (page) {
        await page.close();
      }
    }
  }

  async downloadAndSaveOgImage(
    imageUrl: string,
    sourceUrl: string,
    userId: string
  ): Promise<ScreenshotResult> {
    try {
      // Fetch the image
      const response = await fetch(imageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Teak/1.0; +https://teak.app)',
          Referer: sourceUrl,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      // Determine format from URL or content type
      const contentType = response.headers.get('content-type') || '';
      let format = 'jpeg';
      if (contentType.includes('png') || imageUrl.includes('.png')) {
        format = 'png';
      } else if (contentType.includes('webp') || imageUrl.includes('.webp')) {
        format = 'webp';
      }

      // Generate file info
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(2, 8);
      const filename = `og-image-${timestamp}-${random}.${format}`;
      const datePath = this.createDatePath(userId);
      const relativePath = path.join(datePath, filename);
      const fullPath = path.join(this.uploadsDir, relativePath);
      const dirPath = path.dirname(fullPath);

      // Ensure directory exists
      if (!existsSync(dirPath)) {
        await mkdir(dirPath, { recursive: true });
      }

      // Write file
      await writeFile(fullPath, uint8Array);

      // Generate URL
      const fileUrl = `/api/data/${relativePath}`;

      return {
        url: fileUrl,
        filename,
        path: relativePath,
        size: uint8Array.length,
        width: 0, // We don't know dimensions without processing
        height: 0,
      };
    } catch (error) {
      console.error('OG image download failed:', error);
      throw new Error(
        `Failed to download OG image: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async initializeBrowser(): Promise<void> {
    try {
      const executablePath = '/usr/bin/chromium-browser';

      console.log(`Attempting to launch browser at: ${executablePath}`);

      // Check if the executable exists
      if (existsSync(executablePath)) {
        this.browser = await puppeteer.launch({
          executablePath,
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--window-size=1200,800',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor',
          ],
        });
      } else {
        console.error(`Browser executable not found at: ${executablePath}`);

        // Try common Chrome/Chromium paths
        const commonPaths = [
          '/usr/bin/chromium-browser', // Alpine Linux
          '/usr/bin/chromium',
          '/usr/bin/google-chrome',
          '/usr/bin/google-chrome-stable',
          '/opt/google/chrome/chrome',
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', // macOS
          '/usr/bin/google-chrome-unstable', // Additional Linux path
        ];

        let foundPath = null;
        for (const path of commonPaths) {
          if (existsSync(path)) {
            foundPath = path;
            console.log(`Found browser at alternative path: ${path}`);
            break;
          }
        }

        if (!foundPath) {
          throw new Error(
            `No browser executable found. Tried paths: ${commonPaths.join(', ')}`
          );
        }

        // Use the found path
        this.browser = await puppeteer.launch({
          executablePath: foundPath,
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--window-size=1200,800',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor',
          ],
        });
      }

      console.log('Browser initialized successfully');
    } catch (error) {
      console.error('Failed to initialize browser:', error);
      throw new Error('Failed to initialize browser for screenshots');
    }
  }

  private createDatePath(userId: string): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${userId}/${year}/${month}/${day}`;
  }

  async cleanup(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
