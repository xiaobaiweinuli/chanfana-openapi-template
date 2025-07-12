import { Env, Context, ApiError } from '../types';
import { createSuccessResponse, createErrorResponse, parseJSON, generateId } from '../utils';
import { hasPermission } from '../utils/jwt';

/**
 * 记录文章浏览
 */
export async function recordArticleView(
  request: Request,
  env: Env,
  ctx: any,
  context: Context
): Promise<Response> {
  try {
    const { articleId, visitorId } = await parseJSON(request);

    if (!articleId) {
      throw new ApiError('Article ID is required', 400);
    }

    // 获取请求信息
    const clientIP = request.headers.get('CF-Connecting-IP') || 
                    request.headers.get('X-Forwarded-For') || 
                    'unknown';
    const userAgent = request.headers.get('User-Agent') || '';
    const referer = request.headers.get('Referer') || '';
    
    // 从 Cloudflare 获取地理位置信息
    const country = (request as any).cf?.country || 'unknown';
    const city = (request as any).cf?.city || 'unknown';

    // 检查文章是否存在
    const article = await env.DB.prepare('SELECT id FROM articles WHERE id = ? AND status = ?')
      .bind(articleId, 'published')
      .first();

    if (!article) {
      throw new ApiError('Article not found', 404);
    }

    // 防止重复统计（同一访客1小时内的重复访问）
    if (visitorId) {
      const recentView = await env.DB.prepare(`
        SELECT id FROM article_views 
        WHERE article_id = ? AND visitor_id = ? 
        AND viewed_at > datetime('now', '-1 hour')
      `).bind(articleId, visitorId).first();

      if (recentView) {
        return createSuccessResponse({ message: 'View already recorded recently' });
      }
    }

    // 记录浏览
    const viewId = generateId();
    await env.DB.prepare(`
      INSERT INTO article_views (id, article_id, visitor_id, ip_address, user_agent, referer, country, city)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(viewId, articleId, visitorId, clientIP, userAgent, referer, country, city).run();

    // 更新文章的浏览计数
    await env.DB.prepare(`
      UPDATE articles 
      SET view_count = (
        SELECT COUNT(*) FROM article_views WHERE article_id = ?
      )
      WHERE id = ?
    `).bind(articleId, articleId).run();

    return createSuccessResponse({ message: 'View recorded successfully' });
  } catch (error) {
    console.error('Record article view error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to record view', 500);
  }
}

/**
 * 获取文章统计数据
 */
export async function getArticleStats(
  request: Request,
  env: Env,
  ctx: any,
  context: Context
): Promise<Response> {
  try {
    if (!context.user || !hasPermission(context.user.role, 'collaborator')) {
      throw new ApiError('Insufficient permissions', 403);
    }

    const url = new URL(request.url);
    const period = url.searchParams.get('period') || '7d'; // 7d, 30d, 90d, 1y
    const articleId = url.searchParams.get('articleId');

    let dateFilter = '';
    switch (period) {
      case '7d':
        dateFilter = "datetime('now', '-7 days')";
        break;
      case '30d':
        dateFilter = "datetime('now', '-30 days')";
        break;
      case '90d':
        dateFilter = "datetime('now', '-90 days')";
        break;
      case '1y':
        dateFilter = "datetime('now', '-1 year')";
        break;
      default:
        dateFilter = "datetime('now', '-7 days')";
    }

    if (articleId) {
      // 获取特定文章的统计
      const stats = await env.DB.prepare(`
        SELECT 
          COUNT(*) as total_views,
          COUNT(DISTINCT visitor_id) as unique_visitors,
          COUNT(DISTINCT country) as countries,
          DATE(viewed_at) as date,
          COUNT(*) as daily_views
        FROM article_views 
        WHERE article_id = ? AND viewed_at >= ${dateFilter}
        GROUP BY DATE(viewed_at)
        ORDER BY date DESC
      `).bind(articleId).all();

      const totalStats = await env.DB.prepare(`
        SELECT 
          COUNT(*) as total_views,
          COUNT(DISTINCT visitor_id) as unique_visitors,
          COUNT(DISTINCT country) as countries
        FROM article_views 
        WHERE article_id = ? AND viewed_at >= ${dateFilter}
      `).bind(articleId).first();

      return createSuccessResponse({
        article_id: articleId,
        period,
        total_stats: totalStats,
        daily_stats: stats.results,
      });
    } else {
      // 获取整体统计
      const totalStats = await env.DB.prepare(`
        SELECT 
          COUNT(*) as total_views,
          COUNT(DISTINCT visitor_id) as unique_visitors,
          COUNT(DISTINCT article_id) as articles_viewed,
          COUNT(DISTINCT country) as countries
        FROM article_views 
        WHERE viewed_at >= ${dateFilter}
      `).first();

      const dailyStats = await env.DB.prepare(`
        SELECT 
          DATE(viewed_at) as date,
          COUNT(*) as views,
          COUNT(DISTINCT visitor_id) as unique_visitors,
          COUNT(DISTINCT article_id) as articles_viewed
        FROM article_views 
        WHERE viewed_at >= ${dateFilter}
        GROUP BY DATE(viewed_at)
        ORDER BY date DESC
      `).all();

      const topArticles = await env.DB.prepare(`
        SELECT 
          a.id,
          a.title,
          a.slug,
          COUNT(av.id) as views,
          COUNT(DISTINCT av.visitor_id) as unique_visitors
        FROM articles a
        LEFT JOIN article_views av ON a.id = av.article_id 
          AND av.viewed_at >= ${dateFilter}
        WHERE a.status = 'published'
        GROUP BY a.id, a.title, a.slug
        ORDER BY views DESC
        LIMIT 10
      `).all();

      const topCountries = await env.DB.prepare(`
        SELECT 
          country,
          COUNT(*) as views,
          COUNT(DISTINCT visitor_id) as unique_visitors
        FROM article_views 
        WHERE viewed_at >= ${dateFilter} AND country != 'unknown'
        GROUP BY country
        ORDER BY views DESC
        LIMIT 10
      `).all();

      return createSuccessResponse({
        period,
        total_stats: totalStats,
        daily_stats: dailyStats.results,
        top_articles: topArticles.results,
        top_countries: topCountries.results,
      });
    }
  } catch (error) {
    console.error('Get article stats error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to get stats', 500);
  }
}

/**
 * 获取仪表板统计数据
 */
export async function getDashboardStats(
  request: Request,
  env: Env,
  ctx: any,
  context: Context
): Promise<Response> {
  try {
    if (!context.user || !hasPermission(context.user.role, 'collaborator')) {
      throw new ApiError('Insufficient permissions', 403);
    }

    // 文章统计
    const articleStats = await env.DB.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) as published,
        SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as draft,
        SUM(CASE WHEN created_at >= datetime('now', '-30 days') THEN 1 ELSE 0 END) as recent
      FROM articles
    `).first();

    // 用户统计
    const userStats = await env.DB.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) as admins,
        SUM(CASE WHEN role = 'collaborator' THEN 1 ELSE 0 END) as collaborators,
        SUM(CASE WHEN created_at >= datetime('now', '-30 days') THEN 1 ELSE 0 END) as recent
      FROM users
    `).first();

    // 浏览量统计
    const viewStats = await env.DB.prepare(`
      SELECT 
        COUNT(*) as total_views,
        COUNT(DISTINCT visitor_id) as unique_visitors,
        COUNT(DISTINCT article_id) as viewed_articles,
        SUM(CASE WHEN viewed_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END) as recent_views
      FROM article_views
    `).first();

    // 文件统计
    const fileStats = await env.DB.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(size) as total_size,
        SUM(CASE WHEN type LIKE 'image/%' THEN 1 ELSE 0 END) as images,
        SUM(CASE WHEN uploaded_at >= datetime('now', '-30 days') THEN 1 ELSE 0 END) as recent
      FROM files
    `).first();

    // 最近7天的浏览趋势
    const viewTrend = await env.DB.prepare(`
      SELECT 
        DATE(viewed_at) as date,
        COUNT(*) as views,
        COUNT(DISTINCT visitor_id) as unique_visitors
      FROM article_views 
      WHERE viewed_at >= datetime('now', '-7 days')
      GROUP BY DATE(viewed_at)
      ORDER BY date ASC
    `).all();

    // 热门文章（最近30天）
    const popularArticles = await env.DB.prepare(`
      SELECT 
        a.id,
        a.title,
        a.slug,
        COUNT(av.id) as views
      FROM articles a
      LEFT JOIN article_views av ON a.id = av.article_id 
        AND av.viewed_at >= datetime('now', '-30 days')
      WHERE a.status = 'published'
      GROUP BY a.id, a.title, a.slug
      ORDER BY views DESC
      LIMIT 5
    `).all();

    return createSuccessResponse({
      articles: articleStats,
      users: userStats,
      views: viewStats,
      files: fileStats,
      view_trend: viewTrend.results,
      popular_articles: popularArticles.results,
    });
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to get dashboard stats', 500);
  }
}

/**
 * 获取热门标签统计
 */
export async function getPopularTags(
  request: Request,
  env: Env,
  ctx: any,
  context: Context
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '20');
    const period = url.searchParams.get('period') || '30d';

    let dateFilter = '';
    switch (period) {
      case '7d':
        dateFilter = "AND a.published_at >= datetime('now', '-7 days')";
        break;
      case '30d':
        dateFilter = "AND a.published_at >= datetime('now', '-30 days')";
        break;
      case '90d':
        dateFilter = "AND a.published_at >= datetime('now', '-90 days')";
        break;
      case '1y':
        dateFilter = "AND a.published_at >= datetime('now', '-1 year')";
        break;
    }

    // 这个查询比较复杂，因为标签存储在JSON数组中
    // 我们需要展开JSON数组并统计每个标签的使用次数
    const popularTags = await env.DB.prepare(`
      SELECT 
        t.name,
        t.slug,
        t.color,
        COUNT(a.id) as article_count,
        COALESCE(SUM(a.view_count), 0) as total_views
      FROM tags t
      LEFT JOIN articles a ON JSON_EXTRACT(a.tags, '$') LIKE '%"' || t.slug || '"%'
        AND a.status = 'published' ${dateFilter}
      GROUP BY t.id, t.name, t.slug, t.color
      ORDER BY article_count DESC, total_views DESC
      LIMIT ?
    `).bind(limit).all();

    return createSuccessResponse({
      period,
      tags: popularTags.results,
    });
  } catch (error) {
    console.error('Get popular tags error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to get popular tags', 500);
  }
}
