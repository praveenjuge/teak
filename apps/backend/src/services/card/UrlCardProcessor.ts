import type { ProcessedCardData, ProcessingContext } from '@teak/shared-types';
import { type HTMLElement, parse } from 'node-html-parser';
import { ScreenshotService } from '../screenshot/ScreenshotService.js';
import { CardProcessor } from './card-processor.js';

interface UrlMetadata {
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  type?: string;
  url?: string;
}

export class UrlCardProcessor extends CardProcessor {
  private screenshotService: ScreenshotService;

  constructor() {
    super();
    this.screenshotService = new ScreenshotService();
  }

  async process(context: ProcessingContext): Promise<ProcessedCardData> {
    const url = context.inputData.url as string;

    if (!(url && this.isValidUrl(url))) {
      throw new Error('URL card requires a valid url field');
    }

    // Extract metadata from the URL
    const metadata = await this.extractUrlMetadata(url);

    // Generate screenshot or use OG image
    let screenshotUrl = '';
    try {
      if (metadata.image) {
        console.log(`Found OG image for ${url}: ${metadata.image}`);
        // If there's an OG image, download and save it instead of taking a screenshot
        const ogImageResult =
          await this.screenshotService.downloadAndSaveOgImage(
            metadata.image,
            url,
            context.userId
          );
        screenshotUrl = ogImageResult.url;
        console.log(`OG image saved as: ${screenshotUrl}`);
      } else {
        console.log(`No OG image found for ${url}, taking screenshot`);
        // If no OG image, take a screenshot
        const screenshotResult = await this.screenshotService.takeScreenshot(
          url,
          context.userId,
          {
            width: 1200,
            height: 800,
            format: 'jpeg',
            quality: 85,
          }
        );
        screenshotUrl = screenshotResult.url;
        console.log(`Screenshot saved as: ${screenshotUrl}`);
      }
    } catch (error) {
      console.warn(`Failed to generate screenshot for ${url}:`, error);
      // Continue without screenshot - not a fatal error
    }

    return {
      data: {
        url,
        title: metadata.title || '',
        description: metadata.description || '',
        image: metadata.image || '',
        screenshot_url: screenshotUrl,
      },
      metaInfo: {
        site_name: metadata.siteName,
        og_type: metadata.type,
        canonical_url: metadata.url,
        fetched_at: new Date().toISOString(),
        ...(context.inputData.metaInfo as Record<string, unknown> || {}),
      },
    };
  }

  private async extractUrlMetadata(url: string): Promise<UrlMetadata> {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Teak/1.0; +https://teak.app)',
        },
      });

      if (!response.ok) {
        console.warn(`Failed to fetch URL ${url}: ${response.status}`);
        return {};
      }

      const html = await response.text();
      const root = parse(html);

      return {
        title: this.extractTitle(root),
        description: this.extractDescription(root),
        image: this.extractImage(root, url),
        siteName: this.extractSiteName(root),
        type: this.extractType(root),
        url: this.extractCanonicalUrl(root, url),
      };
    } catch (error) {
      console.warn(`Failed to extract metadata from ${url}:`, error);
      return {};
    }
  }

  private extractTitle(root: HTMLElement): string | undefined {
    // Try OG title first, then Twitter title, then regular title
    return (
      root
        .querySelector('meta[property="og:title"]')
        ?.getAttribute('content') ||
      root
        .querySelector('meta[name="twitter:title"]')
        ?.getAttribute('content') ||
      root.querySelector('title')?.text?.trim()
    );
  }

  private extractDescription(root: HTMLElement): string | undefined {
    // Try OG description first, then Twitter description, then meta description
    return (
      root
        .querySelector('meta[property="og:description"]')
        ?.getAttribute('content') ||
      root
        .querySelector('meta[name="twitter:description"]')
        ?.getAttribute('content') ||
      root.querySelector('meta[name="description"]')?.getAttribute('content')
    );
  }

  private extractImage(root: HTMLElement, baseUrl: string): string | undefined {
    const image =
      root
        .querySelector('meta[property="og:image"]')
        ?.getAttribute('content') ||
      root
        .querySelector('meta[name="twitter:image"]')
        ?.getAttribute('content') ||
      root
        .querySelector('meta[name="twitter:image:src"]')
        ?.getAttribute('content');

    if (!image) {
      return;
    }

    // Convert relative URLs to absolute
    try {
      if (image.startsWith('http')) {
        return image;
      }
      const base = new URL(baseUrl);
      return new URL(image, base.origin).toString();
    } catch {
      return image;
    }
  }

  private extractSiteName(root: HTMLElement): string | undefined {
    return (
      root
        .querySelector('meta[property="og:site_name"]')
        ?.getAttribute('content') ||
      root
        .querySelector('meta[name="application-name"]')
        ?.getAttribute('content')
    );
  }

  private extractType(root: HTMLElement): string | undefined {
    return root
      .querySelector('meta[property="og:type"]')
      ?.getAttribute('content');
  }

  private extractCanonicalUrl(
    root: HTMLElement,
    fallbackUrl: string
  ): string | undefined {
    return (
      root.querySelector('meta[property="og:url"]')?.getAttribute('content') ||
      root.querySelector('link[rel="canonical"]')?.getAttribute('href') ||
      fallbackUrl
    );
  }
}
