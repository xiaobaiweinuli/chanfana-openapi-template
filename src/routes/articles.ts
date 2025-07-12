import { Env, Context, ApiError } from '../types';
import { DatabaseService } from '../services/database';
import { AIService } from '../services/ai';
import { createSuccessResponse, createErrorResponse, parseJSON, generateSlug } from '../utils';
import { hasPermission } from '../utils/jwt';

/**
 * 获取文章列表
 */
export async function getArticles(
  request: Request,
  env: Env,
  ctx: any,
  context: Context
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = parseInt(url.searchParams.get('limit') || '20');
    const status = url.searchParams.get('status') || 'published';
    const category = url.searchParams.get('category') || '';
    const author_id = url.searchParams.get('author_id') || '';

    const dbService = new DatabaseService(env.DB);
    
    // 构建查询选项
    const options: any = {
      limit,
      offset: (page - 1) * limit,
      orderBy: 'published_at DESC',
    };

    // 权限检查：非管理员只能查看已发布的文章
    if (!context.user || !hasPermission(context.user.role, 'collaborator')) {
      options.status = 'published';
    } else if (status) {
      options.status = status;
    }

    if (category) {
      options.category = category;
    }

    if (author_id) {
      options.author_id = author_id;
    }

    const result = await dbService.getArticles(options);
    
    return createSuccessResponse(result);
  } catch (error) {
    console.error('Get articles error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to get articles', 500);
  }
}

/**
 * 根据 slug 获取文章
 */
export async function getArticleBySlug(
  request: Request,
  env: Env,
  ctx: any,
  context: Context,
  slug: string
): Promise<Response> {
  try {
    const dbService = new DatabaseService(env.DB);
    const article = await dbService.getArticleBySlug(slug);
    
    if (!article) {
      throw new ApiError('Article not found', 404);
    }

    // 权限检查：未发布的文章只有作者和管理员可以查看
    if (article.status !== 'published') {
      if (!context.user || 
          (article.author_id !== context.user.id && !hasPermission(context.user.role, 'admin'))) {
        throw new ApiError('Article not found', 404);
      }
    }

    // 增加浏览量（异步执行，不影响响应）
    if (article.status === 'published') {
      ctx.waitUntil(
        env.DB.prepare('UPDATE articles SET view_count = view_count + 1 WHERE id = ?')
          .bind(article.id)
          .run()
      );
    }

    return createSuccessResponse(article);
  } catch (error) {
    console.error('Get article error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to get article', 500);
  }
}

/**
 * 创建文章
 */
export async function createArticle(
  request: Request,
  env: Env,
  ctx: any,
  context: Context
): Promise<Response> {
  try {
    if (!context.user) {
      throw new ApiError('Authentication required', 401);
    }

    if (!hasPermission(context.user.role, 'collaborator')) {
      throw new ApiError('Insufficient permissions', 403);
    }

    const articleData = await parseJSON(request);
    const { title, content, excerpt, category, tags, status = 'draft', cover_image } = articleData;

    if (!title || !content) {
      throw new ApiError('Title and content are required', 400);
    }

    const dbService = new DatabaseService(env.DB);
    
    // 生成 slug
    let slug = generateSlug(title);
    
    // 确保 slug 唯一
    let counter = 1;
    let originalSlug = slug;
    while (await dbService.getArticleBySlug(slug)) {
      slug = `${originalSlug}-${counter}`;
      counter++;
    }

    // 自动生成摘要（如果未提供）
    let finalExcerpt = excerpt;
    if (!finalExcerpt && content) {
      try {
        const aiService = new AIService(env.AI);
        finalExcerpt = await aiService.generateSummary({
          content,
          maxLength: 150,
        });
      } catch (error) {
        console.warn('Failed to generate excerpt:', error);
        // 使用内容的前150个字符作为摘要
        finalExcerpt = content.substring(0, 150) + '...';
      }
    }

    const article = await dbService.createArticle({
      title,
      slug,
      content,
      excerpt: finalExcerpt,
      category: category || 'uncategorized',
      tags: Array.isArray(tags) ? tags : [],
      status,
      cover_image,
      author_id: context.user.id,
      published_at: status === 'published' ? new Date().toISOString() : undefined,
      view_count: 0,
      like_count: 0,
    });

    return createSuccessResponse(article);
  } catch (error) {
    console.error('Create article error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to create article', 500);
  }
}

/**
 * 更新文章
 */
export async function updateArticle(
  request: Request,
  env: Env,
  ctx: any,
  context: Context,
  articleId: string
): Promise<Response> {
  try {
    if (!context.user) {
      throw new ApiError('Authentication required', 401);
    }

    const dbService = new DatabaseService(env.DB);
    
    // 获取现有文章
    const existingArticle = await env.DB.prepare('SELECT * FROM articles WHERE id = ?').bind(articleId).first();
    if (!existingArticle) {
      throw new ApiError('Article not found', 404);
    }

    // 权限检查：只有作者或管理员可以编辑
    if (existingArticle.author_id !== context.user.id && !hasPermission(context.user.role, 'admin')) {
      throw new ApiError('Insufficient permissions', 403);
    }

    const updateData = await parseJSON(request);
    const { title, content, excerpt, category, tags, status, cover_image } = updateData;

    // 构建更新数据
    const updates: any = {
      updated_at: new Date().toISOString(),
    };

    if (title !== undefined) {
      updates.title = title;
      // 如果标题改变，可能需要更新 slug
      if (title !== existingArticle.title) {
        let newSlug = generateSlug(title);
        let counter = 1;
        let originalSlug = newSlug;
        while (await dbService.getArticleBySlug(newSlug) && newSlug !== existingArticle.slug) {
          newSlug = `${originalSlug}-${counter}`;
          counter++;
        }
        updates.slug = newSlug;
      }
    }

    if (content !== undefined) updates.content = content;
    if (excerpt !== undefined) updates.excerpt = excerpt;
    if (category !== undefined) updates.category = category;
    if (tags !== undefined) updates.tags = JSON.stringify(Array.isArray(tags) ? tags : []);
    if (cover_image !== undefined) updates.cover_image = cover_image;

    if (status !== undefined) {
      updates.status = status;
      // 如果从草稿变为发布，设置发布时间
      if (status === 'published' && existingArticle.status !== 'published') {
        updates.published_at = new Date().toISOString();
      }
    }

    // 执行更新
    const setClause = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const values = Object.values(updates);
    
    await env.DB.prepare(`UPDATE articles SET ${setClause} WHERE id = ?`)
      .bind(...values, articleId)
      .run();

    // 获取更新后的文章
    const updatedArticle = await dbService.getArticleBySlug(updates.slug || existingArticle.slug);

    return createSuccessResponse(updatedArticle);
  } catch (error) {
    console.error('Update article error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to update article', 500);
  }
}

/**
 * 删除文章
 */
export async function deleteArticle(
  request: Request,
  env: Env,
  ctx: any,
  context: Context,
  articleId: string
): Promise<Response> {
  try {
    if (!context.user) {
      throw new ApiError('Authentication required', 401);
    }

    const dbService = new DatabaseService(env.DB);
    
    // 获取文章
    const article = await env.DB.prepare('SELECT * FROM articles WHERE id = ?').bind(articleId).first();
    if (!article) {
      throw new ApiError('Article not found', 404);
    }

    // 权限检查：只有作者或管理员可以删除
    if (article.author_id !== context.user.id && !hasPermission(context.user.role, 'admin')) {
      throw new ApiError('Insufficient permissions', 403);
    }

    // 删除文章
    await env.DB.prepare('DELETE FROM articles WHERE id = ?').bind(articleId).run();

    return createSuccessResponse({ message: 'Article deleted successfully' });
  } catch (error) {
    console.error('Delete article error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to delete article', 500);
  }
}
