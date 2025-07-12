import { Env, Context, ApiError } from '../types';
import { createSuccessResponse, createErrorResponse, parseJSON, generateId } from '../utils';
import { hasPermission } from '../utils/jwt';

/**
 * 获取友情链接列表
 */
export async function getFriendLinks(
  request: Request,
  env: Env,
  ctx: any,
  context: Context
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const category = url.searchParams.get('category');
    const featured = url.searchParams.get('featured');
    const includeAll = url.searchParams.get('includeAll') === 'true';

    let whereClause = '';
    const bindings: any[] = [];

    // 权限检查：非管理员只能查看已通过的链接
    if (!context.user || !hasPermission(context.user.role, 'collaborator')) {
      whereClause = 'WHERE status = ?';
      bindings.push('approved');
    } else if (!includeAll) {
      // 管理员可以查看所有状态，但可以按状态筛选
      const conditions = [];
      if (status) {
        conditions.push('status = ?');
        bindings.push(status);
      }
      if (category) {
        conditions.push('category = ?');
        bindings.push(category);
      }
      if (featured !== null) {
        conditions.push('is_featured = ?');
        bindings.push(featured === 'true');
      }
      if (conditions.length > 0) {
        whereClause = 'WHERE ' + conditions.join(' AND ');
      }
    }

    const query = `
      SELECT * FROM friend_links 
      ${whereClause}
      ORDER BY is_featured DESC, order_index ASC, name ASC
    `;

    const result = await env.DB.prepare(query).bind(...bindings).all();
    
    const links = result.results.map((row: any) => ({
      id: row.id,
      name: row.name,
      url: row.url,
      description: row.description,
      avatar: row.avatar,
      category: row.category,
      status: row.status,
      order_index: Number(row.order_index),
      is_featured: Boolean(row.is_featured),
      contact_email: row.contact_email,
      created_at: row.created_at,
      updated_at: row.updated_at,
      approved_at: row.approved_at,
      created_by: row.created_by,
      approved_by: row.approved_by,
    }));

    return createSuccessResponse(links);
  } catch (error) {
    console.error('Get friend links error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to get friend links', 500);
  }
}

/**
 * 创建友情链接
 */
export async function createFriendLink(
  request: Request,
  env: Env,
  ctx: any,
  context: Context
): Promise<Response> {
  try {
    const {
      name,
      url,
      description,
      avatar,
      category = 'friend',
      contact_email,
      order_index = 0,
      is_featured = false,
    } = await parseJSON(request);

    if (!name || !url) {
      throw new ApiError('Name and URL are required', 400);
    }

    // URL 格式验证
    try {
      new URL(url);
    } catch {
      throw new ApiError('Invalid URL format', 400);
    }

    const linkId = generateId();
    const now = new Date().toISOString();
    
    // 如果用户未登录，状态为待审核；如果是管理员，可以直接通过
    const status = context.user && hasPermission(context.user.role, 'admin') ? 'approved' : 'pending';
    const approved_at = status === 'approved' ? now : null;
    const approved_by = status === 'approved' && context.user ? context.user.id : null;

    await env.DB.prepare(`
      INSERT INTO friend_links (
        id, name, url, description, avatar, category, status, order_index, 
        is_featured, contact_email, created_at, updated_at, approved_at, 
        created_by, approved_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      linkId,
      name,
      url,
      description || null,
      avatar || null,
      category,
      status,
      order_index,
      is_featured,
      contact_email || null,
      now,
      now,
      approved_at,
      context.user?.id || null,
      approved_by
    ).run();

    const link = await env.DB.prepare('SELECT * FROM friend_links WHERE id = ?').bind(linkId).first();

    return createSuccessResponse({
      id: link.id,
      name: link.name,
      url: link.url,
      description: link.description,
      avatar: link.avatar,
      category: link.category,
      status: link.status,
      order_index: Number(link.order_index),
      is_featured: Boolean(link.is_featured),
      contact_email: link.contact_email,
      created_at: link.created_at,
      updated_at: link.updated_at,
      approved_at: link.approved_at,
      created_by: link.created_by,
      approved_by: link.approved_by,
    });
  } catch (error) {
    console.error('Create friend link error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to create friend link', 500);
  }
}

/**
 * 更新友情链接
 */
export async function updateFriendLink(
  request: Request,
  env: Env,
  ctx: any,
  context: Context,
  linkId: string
): Promise<Response> {
  try {
    if (!context.user) {
      throw new ApiError('Authentication required', 401);
    }

    if (!hasPermission(context.user.role, 'collaborator')) {
      throw new ApiError('Insufficient permissions', 403);
    }

    const updateData = await parseJSON(request);

    // 检查链接是否存在
    const existing = await env.DB.prepare('SELECT * FROM friend_links WHERE id = ?').bind(linkId).first();
    if (!existing) {
      throw new ApiError('Friend link not found', 404);
    }

    // URL 格式验证
    if (updateData.url) {
      try {
        new URL(updateData.url);
      } catch {
        throw new ApiError('Invalid URL format', 400);
      }
    }

    const updates: any = {
      updated_at: new Date().toISOString(),
    };

    // 更新字段
    const allowedFields = [
      'name', 'url', 'description', 'avatar', 'category', 
      'order_index', 'is_featured', 'contact_email'
    ];

    allowedFields.forEach(field => {
      if (updateData[field] !== undefined) {
        updates[field] = updateData[field];
      }
    });

    // 状态更新需要管理员权限
    if (updateData.status && hasPermission(context.user.role, 'admin')) {
      updates.status = updateData.status;
      if (updateData.status === 'approved' && existing.status !== 'approved') {
        updates.approved_at = new Date().toISOString();
        updates.approved_by = context.user.id;
      }
    }

    const setClause = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const values = Object.values(updates);

    await env.DB.prepare(`UPDATE friend_links SET ${setClause} WHERE id = ?`)
      .bind(...values, linkId)
      .run();

    const link = await env.DB.prepare('SELECT * FROM friend_links WHERE id = ?').bind(linkId).first();

    return createSuccessResponse({
      id: link.id,
      name: link.name,
      url: link.url,
      description: link.description,
      avatar: link.avatar,
      category: link.category,
      status: link.status,
      order_index: Number(link.order_index),
      is_featured: Boolean(link.is_featured),
      contact_email: link.contact_email,
      created_at: link.created_at,
      updated_at: link.updated_at,
      approved_at: link.approved_at,
      created_by: link.created_by,
      approved_by: link.approved_by,
    });
  } catch (error) {
    console.error('Update friend link error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to update friend link', 500);
  }
}

/**
 * 删除友情链接
 */
export async function deleteFriendLink(
  request: Request,
  env: Env,
  ctx: any,
  context: Context,
  linkId: string
): Promise<Response> {
  try {
    if (!context.user) {
      throw new ApiError('Authentication required', 401);
    }

    if (!hasPermission(context.user.role, 'admin')) {
      throw new ApiError('Insufficient permissions', 403);
    }

    // 检查链接是否存在
    const link = await env.DB.prepare('SELECT * FROM friend_links WHERE id = ?').bind(linkId).first();
    if (!link) {
      throw new ApiError('Friend link not found', 404);
    }

    // 删除链接
    await env.DB.prepare('DELETE FROM friend_links WHERE id = ?').bind(linkId).run();

    return createSuccessResponse({ message: 'Friend link deleted successfully' });
  } catch (error) {
    console.error('Delete friend link error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to delete friend link', 500);
  }
}

/**
 * 批量更新友情链接状态
 */
export async function updateFriendLinksStatus(
  request: Request,
  env: Env,
  ctx: any,
  context: Context
): Promise<Response> {
  try {
    if (!context.user) {
      throw new ApiError('Authentication required', 401);
    }

    if (!hasPermission(context.user.role, 'admin')) {
      throw new ApiError('Insufficient permissions', 403);
    }

    const { linkIds, status } = await parseJSON(request);

    if (!Array.isArray(linkIds) || !status) {
      throw new ApiError('Link IDs array and status are required', 400);
    }

    if (!['pending', 'approved', 'rejected'].includes(status)) {
      throw new ApiError('Invalid status', 400);
    }

    const now = new Date().toISOString();
    const approved_at = status === 'approved' ? now : null;
    const approved_by = status === 'approved' ? context.user.id : null;

    // 批量更新状态
    for (const linkId of linkIds) {
      await env.DB.prepare(`
        UPDATE friend_links 
        SET status = ?, updated_at = ?, approved_at = ?, approved_by = ?
        WHERE id = ?
      `).bind(status, now, approved_at, approved_by, linkId).run();
    }

    return createSuccessResponse({ 
      message: `Successfully updated ${linkIds.length} friend links`,
      updated_count: linkIds.length 
    });
  } catch (error) {
    console.error('Update friend links status error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to update friend links status', 500);
  }
}
