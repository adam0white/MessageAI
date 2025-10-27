/**
 * Link Preview Handler
 * 
 * Fetches Open Graph metadata from URLs for rich link previews
 */

import type { LinkPreview } from '../types';

// URL regex - detects http/https URLs
const URL_REGEX = /(https?:\/\/[^\s<]+[^<.,:;"')\]\s])/gi;

/**
 * Extracts the first URL from a message
 */
export function extractUrl(text: string): string | null {
	const match = text.match(URL_REGEX);
	return match ? match[0] : null;
}

/**
 * Fetches Open Graph metadata from a URL
 */
export async function fetchLinkPreview(url: string, cache?: KVNamespace): Promise<LinkPreview | null> {
	try {
		// Normalize URL
		const normalizedUrl = url.trim();
		
		// Check cache first
		if (cache) {
			const cached = await cache.get(`link:${normalizedUrl}`);
			if (cached) {
				return JSON.parse(cached);
			}
		}

		// Fetch the page with timeout
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

		const response = await fetch(normalizedUrl, {
			signal: controller.signal,
			headers: {
				'User-Agent': 'MessageAI Link Preview Bot/1.0',
			},
		});

		clearTimeout(timeoutId);

		if (!response.ok) {
			return null;
		}

		// Only process HTML content
		const contentType = response.headers.get('content-type') || '';
		if (!contentType.includes('text/html')) {
			return null;
		}

		// Get HTML content (limit to first 100KB to avoid huge pages)
		const html = await response.text();
		const limitedHtml = html.substring(0, 100_000);

		// Extract Open Graph tags
		const preview: LinkPreview = {
			url: normalizedUrl,
		};

		// Extract og:title
		const titleMatch = limitedHtml.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
		if (titleMatch) {
			preview.title = decodeHtmlEntities(titleMatch[1]);
		} else {
			// Fallback to <title> tag
			const fallbackTitleMatch = limitedHtml.match(/<title[^>]*>([^<]+)<\/title>/i);
			if (fallbackTitleMatch) {
				preview.title = decodeHtmlEntities(fallbackTitleMatch[1]);
			}
		}

		// Extract og:description
		const descMatch = limitedHtml.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i);
		if (descMatch) {
			preview.description = decodeHtmlEntities(descMatch[1]);
		} else {
			// Fallback to meta description
			const fallbackDescMatch = limitedHtml.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);
			if (fallbackDescMatch) {
				preview.description = decodeHtmlEntities(fallbackDescMatch[1]);
			}
		}

		// Extract og:image
		const imageMatch = limitedHtml.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
		if (imageMatch) {
			preview.image = makeAbsoluteUrl(imageMatch[1], normalizedUrl);
		}

		// Extract og:site_name
		const siteMatch = limitedHtml.match(/<meta\s+property=["']og:site_name["']\s+content=["']([^"']+)["']/i);
		if (siteMatch) {
			preview.siteName = decodeHtmlEntities(siteMatch[1]);
		}

		// Extract favicon
		const faviconMatch = limitedHtml.match(/<link\s+[^>]*rel=["'](?:icon|shortcut icon)["'][^>]*href=["']([^"']+)["']/i);
		if (faviconMatch) {
			preview.favicon = makeAbsoluteUrl(faviconMatch[1], normalizedUrl);
		} else {
			// Default favicon location
			const urlObj = new URL(normalizedUrl);
			preview.favicon = `${urlObj.protocol}//${urlObj.host}/favicon.ico`;
		}

		// Only return if we got at least title or description
		if (!preview.title && !preview.description) {
			return null;
		}

		// Cache for 24 hours
		if (cache) {
			await cache.put(`link:${normalizedUrl}`, JSON.stringify(preview), {
				expirationTtl: 86400, // 24 hours
			});
		}

		return preview;
	} catch (error) {
		console.error('Error fetching link preview:', error);
		return null;
	}
}

/**
 * Decode HTML entities (basic implementation)
 */
function decodeHtmlEntities(text: string): string {
	const entities: Record<string, string> = {
		'&amp;': '&',
		'&lt;': '<',
		'&gt;': '>',
		'&quot;': '"',
		'&#39;': "'",
		'&apos;': "'",
	};

	return text.replace(/&[a-z]+;|&#\d+;/gi, match => entities[match] || match);
}

/**
 * Make relative URLs absolute
 */
function makeAbsoluteUrl(url: string, baseUrl: string): string {
	try {
		// If already absolute, return as-is
		if (url.startsWith('http://') || url.startsWith('https://')) {
			return url;
		}

		// Handle protocol-relative URLs
		if (url.startsWith('//')) {
			const baseUrlObj = new URL(baseUrl);
			return `${baseUrlObj.protocol}${url}`;
		}

		// Handle absolute paths
		if (url.startsWith('/')) {
			const baseUrlObj = new URL(baseUrl);
			return `${baseUrlObj.protocol}//${baseUrlObj.host}${url}`;
		}

		// Handle relative paths
		return new URL(url, baseUrl).href;
	} catch {
		return url;
	}
}

