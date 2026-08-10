import type { ProfileData } from '../types';
import type { ProfilePlatform } from '../../../lib/profile/url';

/** Shared HTML parsing helpers used by all platform adapters. */

export function htmlDecode(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

export function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return '';
  return htmlDecode(m[1]).replace(/\s+/g, ' ').trim();
}

/** Read a <meta name="..."> or <meta property="..."> content attribute. */
export function metaContent(html: string, key: string): string {
  const patterns = [
    new RegExp(`<meta[^>]+(?:name|property)=["']${key}["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${key}["']`, 'i'),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) {
      const content = m[0].match(/content=["']([^"']*)["']/i);
      if (content) return htmlDecode(content[1]).replace(/\s+/g, ' ').trim();
    }
  }
  return '';
}

/** Extract JSON-LD blocks and return parsed objects. */
export function extractJsonLd(html: string): Record<string, unknown>[] {
  const blocks: Record<string, unknown>[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(m[1]);
      if (Array.isArray(parsed)) {
        parsed.forEach((item) => {
          if (item && typeof item === 'object') blocks.push(item as Record<string, unknown>);
        });
      } else if (parsed && typeof parsed === 'object') {
        blocks.push(parsed as Record<string, unknown>);
      }
    } catch {
      // Ignore malformed JSON-LD blocks.
    }
  }
  return blocks;
}

export function findPersonJsonLd(html: string): Record<string, unknown> | null {
  const blocks = extractJsonLd(html);
  for (const block of blocks) {
    if (String(block['@type'] ?? '').toLowerCase() === 'person') return block;
  }
  return null;
}

/** Strip all HTML tags and normalize whitespace. */
export function stripHtml(html: string, maxLength = 20000): string {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, maxLength);
}

export function toNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(String(value).replace(/[^0-9.]/g, ''));
  return isNaN(n) ? undefined : n;
}

export function toPercentOrUndefined(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const m = String(value).match(/(\d+(?:\.\d+)?)%/);
  if (m) return Math.min(100, Math.max(0, Number(m[1])));
  const n = toNumber(value);
  if (n === undefined) return undefined;
  return Math.min(100, Math.max(0, n));
}

export function arrayFromLd(value: unknown, max = 20): string[] {
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === 'string' ? v.trim() : typeof v === 'object' && v && typeof (v as { name?: unknown }).name === 'string' ? (v as { name: string }).name.trim() : ''))
      .filter(Boolean)
      .slice(0, max);
  }
  return [];
}

/** Build a ProfileData skeleton shared by all adapters. */
export function makeProfileBase(platform: ProfilePlatform | 'unknown', profileUrl: string): ProfileData {
  return {
    platform,
    profileUrl,
    skills: [],
  };
}
