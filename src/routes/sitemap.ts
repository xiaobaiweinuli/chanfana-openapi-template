import { Env, Context, ApiError } from '../types';
import { createSuccessResponse, createErrorResponse } from '../utils';

/**
 * 生成主站点地图索引
 */
export async function generateSitemapIndex(
  request: Request,
  env: Env,
  ctx: any,
  context: Context
): Promise<Response> {
  try {
    const siteUrl = env.SITE_URL || 'https://example.com';
    const now = new Date().toISOString();

    const sitemapIndex = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>${siteUrl}/sitemap-pages.xml</loc>
    <lastmod>${now}</lastmod>
  </sitemap>
  <sitemap>
    <loc>${siteUrl}/sitemap-articles.xml</loc>
    <lastmod>${now}</lastmod>
  </sitemap>
  <sitemap>
    <loc>${siteUrl}/sitemap-categories.xml</loc>
    <lastmod>${now}</lastmod>
  </sitemap>
  <sitemap>
    <loc>${siteUrl}/sitemap-tags.xml</loc>
    <lastmod>${now}</lastmod>
  </sitemap>
</sitemapindex>`;

    return new Response(sitemapIndex, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600', // 缓存1小时
      },
    });
  } catch (error) {
    console.error('Generate sitemap index error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to generate sitemap index', 500);
  }
}

/**
 * 生成页面站点地图
 */
export async function generatePagesSitemap(
  request: Request,
  env: Env,
  ctx: any,
  context: Context
): Promise<Response> {
  try {
    const siteUrl = env.SITE_URL || 'https://example.com';

    // 获取已发布的页面
    const pages = await env.DB.prepare(`
      SELECT slug, updated_at, is_in_menu
      FROM pages 
      WHERE status = 'published'
      ORDER BY order_index ASC, title ASC
    `).all();

    // 静态页面
    const staticPages = [
      { loc: siteUrl, priority: '1.0', changefreq: 'daily' },
      { loc: `${siteUrl}/articles`, priority: '0.9', changefreq: 'daily' },
      { loc: `${siteUrl}/archive`, priority: '0.8', changefreq: 'weekly' },
      { loc: `${siteUrl}/friends`, priority: '0.7', changefreq: 'weekly' },
      { loc: `${siteUrl}/rss`, priority: '0.6', changefreq: 'monthly' },
    ];

    let sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;

    // 添加静态页面
    staticPages.forEach(page => {
      sitemap += `
  <url>
    <loc>${page.loc}</loc>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
    <lastmod>${new Date().toISOString()}</lastmod>
  </url>`;
    });

    // 添加动态页面
    pages.results.forEach((page: any) => {
      const priority = page.is_in_menu ? '0.8' : '0.6';
      sitemap += `
  <url>
    <loc>${siteUrl}/pages/${page.slug}</loc>
    <lastmod>${page.updated_at}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>${priority}</priority>
  </url>`;
    });

    sitemap += `
</urlset>`;

    return new Response(sitemap, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    console.error('Generate pages sitemap error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to generate pages sitemap', 500);
  }
}

/**
 * 生成文章站点地图
 */
export async function generateArticlesSitemap(
  request: Request,
  env: Env,
  ctx: any,
  context: Context
): Promise<Response> {
  try {
    const siteUrl = env.SITE_URL || 'https://example.com';

    // 获取已发布的文章
    const articles = await env.DB.prepare(`
      SELECT slug, published_at, updated_at, view_count
      FROM articles 
      WHERE status = 'published'
      ORDER BY published_at DESC
    `).all();

    let sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;

    articles.results.forEach((article: any) => {
      // 根据浏览量和发布时间计算优先级
      const viewCount = Number(article.view_count || 0);
      const publishedDate = new Date(article.published_at);
      const daysSincePublished = (Date.now() - publishedDate.getTime()) / (1000 * 60 * 60 * 24);
      
      let priority = '0.7';
      if (viewCount > 1000 || daysSincePublished < 7) {
        priority = '0.9';
      } else if (viewCount > 500 || daysSincePublished < 30) {
        priority = '0.8';
      }

      let changefreq = 'monthly';
      if (daysSincePublished < 7) {
        changefreq = 'weekly';
      } else if (daysSincePublished < 30) {
        changefreq = 'monthly';
      }

      sitemap += `
  <url>
    <loc>${siteUrl}/articles/${article.slug}</loc>
    <lastmod>${article.updated_at}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
    });

    sitemap += `
</urlset>`;

    return new Response(sitemap, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    console.error('Generate articles sitemap error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to generate articles sitemap', 500);
  }
}

/**
 * 生成分类站点地图
 */
export async function generateCategoriesSitemap(
  request: Request,
  env: Env,
  ctx: any,
  context: Context
): Promise<Response> {
  try {
    const siteUrl = env.SITE_URL || 'https://example.com';

    // 获取有文章的分类
    const categories = await env.DB.prepare(`
      SELECT c.slug, c.updated_at, COUNT(a.id) as article_count
      FROM categories c
      LEFT JOIN articles a ON a.category = c.slug AND a.status = 'published'
      GROUP BY c.id, c.slug, c.updated_at
      HAVING article_count > 0
      ORDER BY article_count DESC
    `).all();

    let sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;

    categories.results.forEach((category: any) => {
      const articleCount = Number(category.article_count);
      let priority = '0.6';
      if (articleCount > 10) {
        priority = '0.8';
      } else if (articleCount > 5) {
        priority = '0.7';
      }

      sitemap += `
  <url>
    <loc>${siteUrl}/articles?category=${encodeURIComponent(category.slug)}</loc>
    <lastmod>${category.updated_at}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${priority}</priority>
  </url>`;
    });

    sitemap += `
</urlset>`;

    return new Response(sitemap, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    console.error('Generate categories sitemap error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to generate categories sitemap', 500);
  }
}

/**
 * 生成标签站点地图
 */
export async function generateTagsSitemap(
  request: Request,
  env: Env,
  ctx: any,
  context: Context
): Promise<Response> {
  try {
    const siteUrl = env.SITE_URL || 'https://example.com';

    // 获取有文章的标签
    const tags = await env.DB.prepare(`
      SELECT t.slug, t.updated_at, COUNT(a.id) as article_count
      FROM tags t
      LEFT JOIN articles a ON JSON_EXTRACT(a.tags, '$') LIKE '%"' || t.slug || '"%' AND a.status = 'published'
      GROUP BY t.id, t.slug, t.updated_at
      HAVING article_count > 0
      ORDER BY article_count DESC
    `).all();

    let sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;

    tags.results.forEach((tag: any) => {
      const articleCount = Number(tag.article_count);
      let priority = '0.5';
      if (articleCount > 10) {
        priority = '0.7';
      } else if (articleCount > 5) {
        priority = '0.6';
      }

      sitemap += `
  <url>
    <loc>${siteUrl}/articles?tag=${encodeURIComponent(tag.slug)}</loc>
    <lastmod>${tag.updated_at}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${priority}</priority>
  </url>`;
    });

    sitemap += `
</urlset>`;

    return new Response(sitemap, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    console.error('Generate tags sitemap error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to generate tags sitemap', 500);
  }
}

/**
 * 生成多语言站点地图索引
 */
export async function generateMultilingualSitemapIndex(
  request: Request,
  env: Env,
  ctx: any,
  context: Context
): Promise<Response> {
  try {
    const siteUrl = env.SITE_URL || 'https://example.com';
    const now = new Date().toISOString();
    const languages = ['zh', 'en', 'ja'];

    let sitemapIndex = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;

    // 为每种语言生成站点地图
    languages.forEach(lang => {
      sitemapIndex += `
  <sitemap>
    <loc>${siteUrl}/sitemap-${lang}.xml</loc>
    <lastmod>${now}</lastmod>
  </sitemap>`;
    });

    sitemapIndex += `
</sitemapindex>`;

    return new Response(sitemapIndex, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    console.error('Generate multilingual sitemap index error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to generate multilingual sitemap index', 500);
  }
}

/**
 * 生成特定语言的站点地图
 */
export async function generateLanguageSitemap(
  request: Request,
  env: Env,
  ctx: any,
  context: Context,
  language: string
): Promise<Response> {
  try {
    const siteUrl = env.SITE_URL || 'https://example.com';

    // 获取已发布的文章和页面
    const articles = await env.DB.prepare(`
      SELECT slug, published_at, updated_at
      FROM articles 
      WHERE status = 'published'
      ORDER BY published_at DESC
    `).all();

    const pages = await env.DB.prepare(`
      SELECT slug, updated_at
      FROM pages 
      WHERE status = 'published'
      ORDER BY order_index ASC
    `).all();

    let sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">`;

    // 主页
    sitemap += `
  <url>
    <loc>${siteUrl}/${language}</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
    <lastmod>${new Date().toISOString()}</lastmod>
  </url>`;

    // 文章列表页
    sitemap += `
  <url>
    <loc>${siteUrl}/${language}/articles</loc>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
    <lastmod>${new Date().toISOString()}</lastmod>
  </url>`;

    // 文章页面
    articles.results.forEach((article: any) => {
      sitemap += `
  <url>
    <loc>${siteUrl}/${language}/articles/${article.slug}</loc>
    <lastmod>${article.updated_at}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>`;
    });

    // 静态页面
    pages.results.forEach((page: any) => {
      sitemap += `
  <url>
    <loc>${siteUrl}/${language}/pages/${page.slug}</loc>
    <lastmod>${page.updated_at}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>`;
    });

    sitemap += `
</urlset>`;

    return new Response(sitemap, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    console.error('Generate language sitemap error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to generate language sitemap', 500);
  }
}
