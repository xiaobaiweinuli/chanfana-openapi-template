import { Env, Context, ApiError } from '../types';
import { DatabaseService } from '../services/database';
import { createSuccessResponse, createErrorResponse, parseJSON } from '../utils';

/**
 * 搜索文章
 */
export async function searchArticles(
  request: Request,
  env: Env,
  ctx: any,
  context: Context
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const query = url.searchParams.get('q') || '';
    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = parseInt(url.searchParams.get('limit') || '10');
    const category = url.searchParams.get('category') || '';
    const tag = url.searchParams.get('tag') || '';

    // 如果没有搜索查询，返回空结果
    if (!query.trim()) {
      return createSuccessResponse({
        articles: [],
        pagination: {
          page: 1,
          limit,
          total: 0,
          totalPages: 0,
        },
        query: '',
        suggestions: [],
      });
    }

    const dbService = new DatabaseService(env.DB);
    const offset = (page - 1) * limit;

    // 构建搜索查询
    let whereClause = 'WHERE status = ? AND (title LIKE ? OR content LIKE ? OR excerpt LIKE ?)';
    const bindings: any[] = ['published', `%${query}%`, `%${query}%`, `%${query}%`];

    if (category) {
      whereClause += ' AND category = ?';
      bindings.push(category);
    }

    if (tag) {
      whereClause += ' AND tags LIKE ?';
      bindings.push(`%"${tag}"%`);
    }

    // 获取搜索结果总数
    const countResult = await env.DB.prepare(`
      SELECT COUNT(*) as count FROM articles ${whereClause}
    `).bind(...bindings).first();
    const total = countResult?.count as number || 0;

    // 获取搜索结果
    const results = await env.DB.prepare(`
      SELECT 
        id, title, slug, excerpt, summary, cover_image, category, tags,
        author_id, published_at, created_at, updated_at, view_count, like_count
      FROM articles 
      ${whereClause}
      ORDER BY 
        CASE 
          WHEN title LIKE ? THEN 1
          WHEN excerpt LIKE ? THEN 2
          ELSE 3
        END,
        published_at DESC
      LIMIT ? OFFSET ?
    `).bind(...bindings, `%${query}%`, `%${query}%`, limit, offset).all();

    const articles = results.results.map((row: any) => ({
      ...row,
      tags: JSON.parse(row.tags || '[]'),
      view_count: Number(row.view_count),
      like_count: Number(row.like_count),
    }));

    // 生成搜索建议
    const suggestions = await generateSearchSuggestions(query, env.DB);

    const totalPages = Math.ceil(total / limit);

    return createSuccessResponse({
      articles,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
      query,
      suggestions,
    });
  } catch (error) {
    console.error('Search error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Search failed', 500);
  }
}

/**
 * 高级搜索
 */
export async function advancedSearch(
  request: Request,
  env: Env,
  ctx: any,
  context: Context
): Promise<Response> {
  try {
    const {
      query = '',
      categories = [],
      tags = [],
      dateRange = null,
      author = '',
      sortBy = 'relevance', // relevance, date, views
      page = 1,
      limit = 10,
    } = await parseJSON(request);

    const dbService = new DatabaseService(env.DB);
    const offset = (page - 1) * limit;

    // 构建查询条件
    let whereClause = 'WHERE status = ?';
    const bindings: any[] = ['published'];

    if (query.trim()) {
      whereClause += ' AND (title LIKE ? OR content LIKE ? OR excerpt LIKE ?)';
      bindings.push(`%${query}%`, `%${query}%`, `%${query}%`);
    }

    if (categories.length > 0) {
      const categoryPlaceholders = categories.map(() => '?').join(',');
      whereClause += ` AND category IN (${categoryPlaceholders})`;
      bindings.push(...categories);
    }

    if (tags.length > 0) {
      const tagConditions = tags.map(() => 'tags LIKE ?').join(' OR ');
      whereClause += ` AND (${tagConditions})`;
      bindings.push(...tags.map((tag: string) => `%"${tag}"%`));
    }

    if (author) {
      whereClause += ' AND author_id IN (SELECT id FROM users WHERE name LIKE ? OR username LIKE ?)';
      bindings.push(`%${author}%`, `%${author}%`);
    }

    if (dateRange && dateRange.start && dateRange.end) {
      whereClause += ' AND published_at BETWEEN ? AND ?';
      bindings.push(dateRange.start, dateRange.end);
    }

    // 排序逻辑
    let orderBy = 'published_at DESC';
    if (sortBy === 'relevance' && query.trim()) {
      orderBy = `
        CASE 
          WHEN title LIKE ? THEN 1
          WHEN excerpt LIKE ? THEN 2
          ELSE 3
        END,
        published_at DESC
      `;
      bindings.push(`%${query}%`, `%${query}%`);
    } else if (sortBy === 'views') {
      orderBy = 'view_count DESC, published_at DESC';
    } else if (sortBy === 'date') {
      orderBy = 'published_at DESC';
    }

    // 获取总数
    const countResult = await env.DB.prepare(`
      SELECT COUNT(*) as count FROM articles ${whereClause}
    `).bind(...bindings.slice(0, bindings.length - (sortBy === 'relevance' && query.trim() ? 2 : 0))).first();
    const total = countResult?.count as number || 0;

    // 获取结果
    const results = await env.DB.prepare(`
      SELECT 
        id, title, slug, excerpt, summary, cover_image, category, tags,
        author_id, published_at, created_at, updated_at, view_count, like_count
      FROM articles 
      ${whereClause}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `).bind(...bindings, limit, offset).all();

    const articles = results.results.map((row: any) => ({
      ...row,
      tags: JSON.parse(row.tags || '[]'),
      view_count: Number(row.view_count),
      like_count: Number(row.like_count),
    }));

    const totalPages = Math.ceil(total / limit);

    return createSuccessResponse({
      articles,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
      query,
      filters: {
        categories,
        tags,
        dateRange,
        author,
        sortBy,
      },
    });
  } catch (error) {
    console.error('Advanced search error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Advanced search failed', 500);
  }
}

/**
 * 生成搜索建议
 */
async function generateSearchSuggestions(query: string, db: any): Promise<string[]> {
  try {
    // 获取相关标签
    const tagResults = await db.prepare(`
      SELECT DISTINCT tags FROM articles 
      WHERE status = 'published' AND tags LIKE ?
      LIMIT 5
    `).bind(`%${query}%`).all();

    const suggestions: string[] = [];
    
    for (const result of tagResults.results) {
      const tags = JSON.parse(result.tags as string || '[]');
      for (const tag of tags) {
        if (tag.toLowerCase().includes(query.toLowerCase()) && !suggestions.includes(tag)) {
          suggestions.push(tag);
          if (suggestions.length >= 5) break;
        }
      }
      if (suggestions.length >= 5) break;
    }

    // 获取相关分类
    if (suggestions.length < 5) {
      const categoryResults = await db.prepare(`
        SELECT DISTINCT category FROM articles 
        WHERE status = 'published' AND category LIKE ?
        LIMIT ?
      `).bind(`%${query}%`, 5 - suggestions.length).all();

      for (const result of categoryResults.results) {
        if (!suggestions.includes(result.category as string)) {
          suggestions.push(result.category as string);
        }
      }
    }

    return suggestions;
  } catch (error) {
    console.error('Generate suggestions error:', error);
    return [];
  }
}
