import { Env, Context, ApiError } from '../types';
import { createSuccessResponse, createErrorResponse, parseJSON, generateId } from '../utils';
import { hasPermission } from '../utils/jwt';

/**
 * 获取分类列表
 */
export async function getCategories(
  request: Request,
  env: Env,
  ctx: any,
  context: Context
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const includeCount = url.searchParams.get('includeCount') === 'true';

    let query = 'SELECT * FROM categories ORDER BY order_index ASC, name ASC';
    
    if (includeCount) {
      query = `
        SELECT 
          c.*,
          COUNT(a.id) as article_count
        FROM categories c
        LEFT JOIN articles a ON a.category = c.slug AND a.status = 'published'
        GROUP BY c.id
        ORDER BY c.order_index ASC, c.name ASC
      `;
    }

    const result = await env.DB.prepare(query).all();
    
    const categories = result.results.map((row: any) => ({
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

    return createSuccessResponse(categories);
  } catch (error) {
    console.error('Get categories error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to get categories', 500);
  }
}

/**
 * 创建分类
 */
export async function createCategory(
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
    const existing = await env.DB.prepare('SELECT id FROM categories WHERE slug = ?').bind(slug).first();
    if (existing) {
      throw new ApiError('Category slug already exists', 400);
    }

    const categoryId = generateId();
    const now = new Date().toISOString();

    await env.DB.prepare(`
      INSERT INTO categories (id, name, slug, description, color, order_index, created_at, updated_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      categoryId,
      name,
      slug,
      description || null,
      color || '#3b82f6',
      order_index || 0,
      now,
      now,
      context.user.id
    ).run();

    const category = await env.DB.prepare('SELECT * FROM categories WHERE id = ?').bind(categoryId).first();

    return createSuccessResponse({
      id: category.id,
      name: category.name,
      slug: category.slug,
      description: category.description,
      color: category.color,
      order_index: Number(category.order_index),
      created_at: category.created_at,
      updated_at: category.updated_at,
      created_by: category.created_by,
    });
  } catch (error) {
    console.error('Create category error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to create category', 500);
  }
}

/**
 * 更新分类
 */
export async function updateCategory(
  request: Request,
  env: Env,
  ctx: any,
  context: Context,
  categoryId: string
): Promise<Response> {
  try {
    if (!context.user) {
      throw new ApiError('Authentication required', 401);
    }

    if (!hasPermission(context.user.role, 'collaborator')) {
      throw new ApiError('Insufficient permissions', 403);
    }

    const { name, slug, description, color, order_index } = await parseJSON(request);

    // 检查分类是否存在
    const existing = await env.DB.prepare('SELECT * FROM categories WHERE id = ?').bind(categoryId).first();
    if (!existing) {
      throw new ApiError('Category not found', 404);
    }

    // 如果 slug 改变了，检查新 slug 是否已存在
    if (slug && slug !== existing.slug) {
      const slugExists = await env.DB.prepare('SELECT id FROM categories WHERE slug = ? AND id != ?').bind(slug, categoryId).first();
      if (slugExists) {
        throw new ApiError('Category slug already exists', 400);
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

    await env.DB.prepare(`UPDATE categories SET ${setClause} WHERE id = ?`)
      .bind(...values, categoryId)
      .run();

    const category = await env.DB.prepare('SELECT * FROM categories WHERE id = ?').bind(categoryId).first();

    return createSuccessResponse({
      id: category.id,
      name: category.name,
      slug: category.slug,
      description: category.description,
      color: category.color,
      order_index: Number(category.order_index),
      created_at: category.created_at,
      updated_at: category.updated_at,
      created_by: category.created_by,
    });
  } catch (error) {
    console.error('Update category error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to update category', 500);
  }
}

/**
 * 删除分类
 */
export async function deleteCategory(
  request: Request,
  env: Env,
  ctx: any,
  context: Context,
  categoryId: string
): Promise<Response> {
  try {
    if (!context.user) {
      throw new ApiError('Authentication required', 401);
    }

    if (!hasPermission(context.user.role, 'admin')) {
      throw new ApiError('Insufficient permissions', 403);
    }

    // 检查分类是否存在
    const category = await env.DB.prepare('SELECT * FROM categories WHERE id = ?').bind(categoryId).first();
    if (!category) {
      throw new ApiError('Category not found', 404);
    }

    // 检查是否有文章使用此分类
    const articleCount = await env.DB.prepare('SELECT COUNT(*) as count FROM articles WHERE category = ?').bind(category.slug).first();
    if (articleCount && Number(articleCount.count) > 0) {
      throw new ApiError('Cannot delete category with existing articles', 400);
    }

    // 删除分类
    await env.DB.prepare('DELETE FROM categories WHERE id = ?').bind(categoryId).run();

    return createSuccessResponse({ message: 'Category deleted successfully' });
  } catch (error) {
    console.error('Delete category error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to delete category', 500);
  }
}

/**
 * 获取单个分类
 */
export async function getCategoryBySlug(
  request: Request,
  env: Env,
  ctx: any,
  context: Context,
  slug: string
): Promise<Response> {
  try {
    const category = await env.DB.prepare(`
      SELECT 
        c.*,
        COUNT(a.id) as article_count
      FROM categories c
      LEFT JOIN articles a ON a.category = c.slug AND a.status = 'published'
      WHERE c.slug = ?
      GROUP BY c.id
    `).bind(slug).first();

    if (!category) {
      throw new ApiError('Category not found', 404);
    }

    return createSuccessResponse({
      id: category.id,
      name: category.name,
      slug: category.slug,
      description: category.description,
      color: category.color,
      order_index: Number(category.order_index),
      article_count: Number(category.article_count || 0),
      created_at: category.created_at,
      updated_at: category.updated_at,
      created_by: category.created_by,
    });
  } catch (error) {
    console.error('Get category error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to get category', 500);
  }
}
