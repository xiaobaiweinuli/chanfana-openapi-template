import { Env, Context, ApiError } from '../types';
import { createSuccessResponse, createErrorResponse } from '../utils';

/**
 * 生成 RSS Feed
 */
export async function generateRSSFeed(
  request: Request,
  env: Env,
  ctx: any,
  context: Context
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const category = url.searchParams.get('category');
    const tag = url.searchParams.get('tag');
    const limit = parseInt(url.searchParams.get('limit') || '20');

    // 构建查询条件
    let whereClause = 'WHERE status = ?';
    const bindings: any[] = ['published'];

    if (category) {
      whereClause += ' AND category = ?';
      bindings.push(category);
    }

    if (tag) {
      whereClause += ' AND JSON_EXTRACT(tags, "$") LIKE ?';
      bindings.push(`%"${tag}"%`);
    }

    // 查询文章
    const query = `
      SELECT 
        id, title, slug, excerpt, content, category, tags,
        published_at, updated_at, created_by
      FROM articles 
      ${whereClause}
      ORDER BY published_at DESC 
      LIMIT ?
    `;

    const result = await env.DB.prepare(query).bind(...bindings, limit).all();
    const articles = result.results;

    // 获取网站设置
    const siteSettings = await env.DB.prepare('SELECT key, value FROM settings').all();
    const settings = siteSettings.results.reduce((acc: any, row: any) => {
      acc[row.key] = row.value;
      return acc;
    }, {});

    const siteName = settings.site_name || 'Modern Blog';
    const siteDescription = settings.site_description || '现代化的技术博客平台';
    const siteUrl = env.SITE_URL || 'https://example.com';

    // 生成 RSS XML
    const rssXml = generateRSSXML({
      title: category ? `${siteName} - ${category}` : tag ? `${siteName} - ${tag}` : siteName,
      description: siteDescription,
      link: siteUrl,
      language: 'zh-CN',
      articles: articles.map((article: any) => ({
        title: article.title,
        description: article.excerpt || '',
        link: `${siteUrl}/articles/${article.slug}`,
        pubDate: new Date(article.published_at).toUTCString(),
        guid: `${siteUrl}/articles/${article.slug}`,
        category: article.category,
        content: article.content,
      })),
    });

    return new Response(rssXml, {
      headers: {
        'Content-Type': 'application/rss+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600', // 缓存1小时
      },
    });
  } catch (error) {
    console.error('Generate RSS feed error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to generate RSS feed', 500);
  }
}

/**
 * 生成 Atom Feed
 */
export async function generateAtomFeed(
  request: Request,
  env: Env,
  ctx: any,
  context: Context
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const category = url.searchParams.get('category');
    const tag = url.searchParams.get('tag');
    const limit = parseInt(url.searchParams.get('limit') || '20');

    // 构建查询条件
    let whereClause = 'WHERE status = ?';
    const bindings: any[] = ['published'];

    if (category) {
      whereClause += ' AND category = ?';
      bindings.push(category);
    }

    if (tag) {
      whereClause += ' AND JSON_EXTRACT(tags, "$") LIKE ?';
      bindings.push(`%"${tag}"%`);
    }

    // 查询文章
    const query = `
      SELECT 
        id, title, slug, excerpt, content, category, tags,
        published_at, updated_at, created_by
      FROM articles 
      ${whereClause}
      ORDER BY published_at DESC 
      LIMIT ?
    `;

    const result = await env.DB.prepare(query).bind(...bindings, limit).all();
    const articles = result.results;

    // 获取网站设置
    const siteSettings = await env.DB.prepare('SELECT key, value FROM settings').all();
    const settings = siteSettings.results.reduce((acc: any, row: any) => {
      acc[row.key] = row.value;
      return acc;
    }, {});

    const siteName = settings.site_name || 'Modern Blog';
    const siteDescription = settings.site_description || '现代化的技术博客平台';
    const siteUrl = env.SITE_URL || 'https://example.com';

    // 生成 Atom XML
    const atomXml = generateAtomXML({
      title: category ? `${siteName} - ${category}` : tag ? `${siteName} - ${tag}` : siteName,
      subtitle: siteDescription,
      link: siteUrl,
      id: siteUrl,
      updated: articles.length > 0 ? new Date(articles[0].updated_at).toISOString() : new Date().toISOString(),
      articles: articles.map((article: any) => ({
        title: article.title,
        summary: article.excerpt || '',
        link: `${siteUrl}/articles/${article.slug}`,
        id: `${siteUrl}/articles/${article.slug}`,
        published: new Date(article.published_at).toISOString(),
        updated: new Date(article.updated_at).toISOString(),
        content: article.content,
        category: article.category,
      })),
    });

    return new Response(atomXml, {
      headers: {
        'Content-Type': 'application/atom+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600', // 缓存1小时
      },
    });
  } catch (error) {
    console.error('Generate Atom feed error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to generate Atom feed', 500);
  }
}

/**
 * 生成 JSON Feed
 */
export async function generateJSONFeed(
  request: Request,
  env: Env,
  ctx: any,
  context: Context
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const category = url.searchParams.get('category');
    const tag = url.searchParams.get('tag');
    const limit = parseInt(url.searchParams.get('limit') || '20');

    // 构建查询条件
    let whereClause = 'WHERE status = ?';
    const bindings: any[] = ['published'];

    if (category) {
      whereClause += ' AND category = ?';
      bindings.push(category);
    }

    if (tag) {
      whereClause += ' AND JSON_EXTRACT(tags, "$") LIKE ?';
      bindings.push(`%"${tag}"%`);
    }

    // 查询文章
    const query = `
      SELECT 
        id, title, slug, excerpt, content, category, tags,
        published_at, updated_at, created_by
      FROM articles 
      ${whereClause}
      ORDER BY published_at DESC 
      LIMIT ?
    `;

    const result = await env.DB.prepare(query).bind(...bindings, limit).all();
    const articles = result.results;

    // 获取网站设置
    const siteSettings = await env.DB.prepare('SELECT key, value FROM settings').all();
    const settings = siteSettings.results.reduce((acc: any, row: any) => {
      acc[row.key] = row.value;
      return acc;
    }, {});

    const siteName = settings.site_name || 'Modern Blog';
    const siteDescription = settings.site_description || '现代化的技术博客平台';
    const siteUrl = env.SITE_URL || 'https://example.com';

    // 生成 JSON Feed
    const jsonFeed = {
      version: 'https://jsonfeed.org/version/1.1',
      title: category ? `${siteName} - ${category}` : tag ? `${siteName} - ${tag}` : siteName,
      description: siteDescription,
      home_page_url: siteUrl,
      feed_url: `${siteUrl}/api/feed.json`,
      language: 'zh-CN',
      items: articles.map((article: any) => ({
        id: `${siteUrl}/articles/${article.slug}`,
        title: article.title,
        summary: article.excerpt || '',
        content_html: article.content,
        url: `${siteUrl}/articles/${article.slug}`,
        date_published: new Date(article.published_at).toISOString(),
        date_modified: new Date(article.updated_at).toISOString(),
        tags: article.tags ? JSON.parse(article.tags) : [],
      })),
    };

    return new Response(JSON.stringify(jsonFeed, null, 2), {
      headers: {
        'Content-Type': 'application/feed+json; charset=utf-8',
        'Cache-Control': 'public, max-age=3600', // 缓存1小时
      },
    });
  } catch (error) {
    console.error('Generate JSON feed error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to generate JSON feed', 500);
  }
}

/**
 * 生成 RSS XML 内容
 */
function generateRSSXML({
  title,
  description,
  link,
  language = 'zh-CN',
  articles,
}: {
  title: string
  description: string
  link: string
  language?: string
  articles: Array<{
    title: string
    description: string
    link: string
    pubDate: string
    guid: string
    category?: string
    content?: string
  }>
}) {
  const now = new Date().toUTCString();

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title><![CDATA[${title}]]></title>
    <description><![CDATA[${description}]]></description>
    <link>${link}</link>
    <language>${language}</language>
    <lastBuildDate>${now}</lastBuildDate>
    <atom:link href="${link}/api/feed.xml" rel="self" type="application/rss+xml"/>
    ${articles.map(article => `
    <item>
      <title><![CDATA[${article.title}]]></title>
      <description><![CDATA[${article.description}]]></description>
      <link>${article.link}</link>
      <guid isPermaLink="true">${article.guid}</guid>
      <pubDate>${article.pubDate}</pubDate>
      ${article.category ? `<category><![CDATA[${article.category}]]></category>` : ''}
      ${article.content ? `<content:encoded><![CDATA[${article.content}]]></content:encoded>` : ''}
    </item>`).join('')}
  </channel>
</rss>`;
}

/**
 * 生成 Atom XML 内容
 */
function generateAtomXML({
  title,
  subtitle,
  link,
  id,
  updated,
  articles,
}: {
  title: string
  subtitle: string
  link: string
  id: string
  updated: string
  articles: Array<{
    title: string
    summary: string
    link: string
    id: string
    published: string
    updated: string
    content?: string
    category?: string
  }>
}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title><![CDATA[${title}]]></title>
  <subtitle><![CDATA[${subtitle}]]></subtitle>
  <link href="${link}" rel="alternate"/>
  <link href="${link}/api/feed.atom" rel="self"/>
  <id>${id}</id>
  <updated>${updated}</updated>
  ${articles.map(article => `
  <entry>
    <title><![CDATA[${article.title}]]></title>
    <summary><![CDATA[${article.summary}]]></summary>
    <link href="${article.link}" rel="alternate"/>
    <id>${article.id}</id>
    <published>${article.published}</published>
    <updated>${article.updated}</updated>
    ${article.content ? `<content type="html"><![CDATA[${article.content}]]></content>` : ''}
    ${article.category ? `<category term="${article.category}"/>` : ''}
  </entry>`).join('')}
</feed>`;
}
