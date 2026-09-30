import type { APIRoute } from 'astro';
import { absoluteUrl } from '../config/site';

/**
 * Only indexable pages belong here. /privacy, /terms and /support are `noindex` interim pages until
 * their final content is published; add them to this list when they go live.
 */
const PATHS = ['/'];

export const GET: APIRoute = () => {
  const urls = PATHS.map((p) => `  <url><loc>${absoluteUrl(p)}</loc></url>`).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
