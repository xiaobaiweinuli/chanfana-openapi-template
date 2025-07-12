import { Env, Context, ApiError } from '../types';
import { createSuccessResponse, createErrorResponse, parseJSON, generateId } from '../utils';
import { hasPermission } from '../utils/jwt';

/**
 * 获取标签列表
 */
export async function getTags(
  request: Request,
  env: Env,
  ctx: any,
  context: Context
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const includeCount = url.searchParams.get('includeCount') === 'true';

    let query = 'SELECT * FROM tags ORDER BY order_index ASC, name ASC';
    
    if (includeCount) {
      query = `
        SELECT 
          t.*,
          COUNT(DISTINCT a.id) as article_count
        FROM tags t
        LEFT JOIN articles a ON JSON_EXTRACT(a.tags, '$') LIKE '%"' || t.slug || '"%' AND a.status = 'published'
        GROUP BY t.id
        ORDER BY t.order_index ASC, t.name ASC
      `;
    }

    const result = await env.DB.prepare(query).all();
    
    const tags = result.results.map((row: any) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      color: row.color,
      order_index: Number(row.order_index),
      article_count: includeCount ? Number(row.article_count || 0) : undefined,
      created_at: row.created_at,
      updated_at: row.updated_at,
      created_by: row.created_by,
    }));

    return createSuccessResponse(tags);
  } catch (error) {
    console.error('Get tags error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to get tags', 500);
  }
}

/**
 * 创建标签
 */
export async function createTag(
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

    const { name, slug, description, color, order_index } = await parseJSON(request);

    if (!name || !slug) {
      throw new ApiError('Name and slug are required', 400);
    }

    // 检查 slug 是否已存在
    const existing = await env.DB.prepare('SELECT id FROM tags WHERE slug = ?').bind(slug).first();
    if (existing) {
      throw new ApiError('Tag slug already exists', 400);
    }

    const tagId = generateId();
    const now = new Date().toISOString();

    await env.DB.prepare(`
      INSERT INTO tags (id, name, slug, description, color, order_index, created_at, updated_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      tagId,
      name,
      slug,
      description || null,
      color || '#10b981',
      order_index || 0,
      now,
      now,
      context.user.id
    ).run();

    const tag = await env.DB.prepare('SELECT * FROM tags WHERE id = ?').bind(tagId).first();

    return createSuccessResponse({
      id: tag.id,
      name: tag.name,
      slug: tag.slug,
      description: tag.description,
      color: tag.color,
      order_index: Number(tag.order_index),
      created_at: tag.created_at,
      updated_at: tag.updated_at,
      created_by: tag.created_by,
    });
  } catch (error) {
    console.error('Create tag error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to create tag', 500);
  }
}

/**
 * 更新标签
 */
export async function updateTag(
  request: Request,
  env: Env,
  ctx: any,
  context: Context,
  tagId: string
): Promise<Response> {
  try {
    if (!context.user) {
      throw new ApiError('Authentication required', 401);
    }

    if (!hasPermission(context.user.role, 'collaborator')) {
      throw new ApiError('Insufficient permissions', 403);
    }

    const { name, slug, description, color, order_index } = await parseJSON(request);

    // 检查标签是否存在
    const existing = await env.DB.prepare('SELECT * FROM tags WHERE id = ?').bind(tagId).first();
    if (!existing) {
      throw new ApiError('Tag not found', 404);
    }

    // 如果 slug 改变了，检查新 slug 是否已存在
    if (slug && slug !== existing.slug) {
      const slugExists = await env.DB.prepare('SELECT id FROM tags WHERE slug = ? AND id != ?').bind(slug, tagId).first();
      if (slugExists) {
        throw new ApiError('Tag slug already exists', 400);
      }
    }

    const updates: any = {
      updated_at: new Date().toISOString(),
    };

    if (name !== undefined) updates.name = name;
    if (slug !== undefined) updates.slug = slug;
    if (description !== undefined) updates.description = description;
    if (color !== undefined) updates.color = color;
    if (order_index !== undefined) updates.order_index = order_index;

    const setClause = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const values = Object.values(updates);

    await env.DB.prepare(`UPDATE tags SET ${setClause} WHERE id = ?`)
      .bind(...values, tagId)
      .run();

    const tag = await env.DB.prepare('SELECT * FROM tags WHERE id = ?').bind(tagId).first();

    return createSuccessResponse({
      id: tag.id,
      name: tag.name,
      slug: tag.slug,
      description: tag.description,
      color: tag.color,
      order_index: Number(tag.order_index),
      created_at: tag.created_at,
      updated_at: tag.updated_at,
      created_by: tag.created_by,
    });
  } catch (error) {
    console.error('Update tag error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to update tag', 500);
  }
}

/**
 * 删除标签
 */
export async function deleteTag(
  request: Request,
  env: Env,
  ctx: any,
  context: Context,
  tagId: string
): Promise<Response> {
  try {
    if (!context.user) {
      throw new ApiError('Authentication required', 401);
    }

    if (!hasPermission(context.user.role, 'admin')) {
      throw new ApiError('Insufficient permissions', 403);
    }

    // 检查标签是否存在
    const tag = await env.DB.prepare('SELECT * FROM tags WHERE id = ?').bind(tagId).first();
    if (!tag) {
      throw new ApiError('Tag not found', 404);
    }

    // 检查是否有文章使用此标签
    const articleCount = await env.DB.prepare(`
      SELECT COUNT(*) as count FROM articles 
      WHERE JSON_EXTRACT(tags, '$') LIKE '%"' || ? || '"%'
    `).bind(tag.slug).first();
    
    if (articleCount && Number(articleCount.count) > 0) {
      throw new ApiError('Cannot delete tag with existing articles', 400);
    }

    // 删除标签
    await env.DB.prepare('DELETE FROM tags WHERE id = ?').bind(tagId).run();

    return createSuccessResponse({ message: 'Tag deleted successfully' });
  } catch (error) {
    console.error('Delete tag error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to delete tag', 500);
  }
}

/**
 * 获取单个标签
 */
export async function getTagBySlug(
  request: Request,
  env: Env,
  ctx: any,
  context: Context,
  slug: string
): Promise<Response> {
  try {
    const tag = await env.DB.prepare(`
      SELECT 
        t.*,
        COUNT(DISTINCT a.id) as article_count
      FROM tags t
      LEFT JOIN articles a ON JSON_EXTRACT(a.tags, '$') LIKE '%"' || t.slug || '"%' AND a.status = 'published'
      WHERE t.slug = ?
      GROUP BY t.id
    `).bind(slug).first();

    if (!tag) {
      throw new ApiError('Tag not found', 404);
    }

    return createSuccessResponse({
      id: tag.id,
      name: tag.name,
      slug: tag.slug,
      description: tag.description,
      color: tag.color,
      order_index: Number(tag.order_index),
      article_count: Number(tag.article_count || 0),
      created_at: tag.created_at,
      updated_at: tag.updated_at,
      created_by: tag.created_by,
    });
  } catch (error) {
    console.error('Get tag error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to get tag', 500);
  }
}

/**
 * 批量更新标签顺序
 */
export async function updateTagsOrder(
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

    const { tags } = await parseJSON(request);

    if (!Array.isArray(tags)) {
      throw new ApiError('Tags must be an array', 400);
    }

    // 批量更新顺序
    for (const tag of tags) {
      if (tag.id && typeof tag.order_index === 'number') {
        await env.DB.prepare('UPDATE tags SET order_index = ?, updated_at = ? WHERE id = ?')
          .bind(tag.order_index, new Date().toISOString(), tag.id)
          .run();
      }
    }

    return createSuccessResponse({ message: 'Tags order updated successfully' });
  } catch (error) {
    console.error('Update tags order error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to update tags order', 500);
  }
}
