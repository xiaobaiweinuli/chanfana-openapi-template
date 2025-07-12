import { Env, Context, ApiError } from '../types';
import { DatabaseService } from '../services/database';
import { createSuccessResponse, createErrorResponse, parseJSON } from '../utils';
import { hasPermission } from '../utils/jwt';

/**
 * 获取用户列表
 */
export async function getUsers(
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

    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = parseInt(url.searchParams.get('limit') || '20');
    const role = url.searchParams.get('role') || '';

    const dbService = new DatabaseService(env.DB);
    
    const options: any = {
      limit,
      offset: (page - 1) * limit,
      orderBy: 'created_at DESC',
    };

    if (role) {
      options.where = { role };
    }

    const result = await dbService.getUsers(options);
    
    return createSuccessResponse(result);
  } catch (error) {
    console.error('Get users error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to get users', 500);
  }
}

/**
 * 根据 ID 获取用户
 */
export async function getUserById(
  request: Request,
  env: Env,
  ctx: any,
  context: Context,
  userId: string
): Promise<Response> {
  try {
    if (!context.user) {
      throw new ApiError('Authentication required', 401);
    }

    // 用户只能查看自己的信息，管理员可以查看所有用户
    if (context.user.id !== userId && !hasPermission(context.user.role, 'admin')) {
      throw new ApiError('Insufficient permissions', 403);
    }

    const dbService = new DatabaseService(env.DB);
    const user = await dbService.getUserById(userId);
    
    if (!user) {
      throw new ApiError('User not found', 404);
    }

    // 移除敏感信息
    const { github_id, ...safeUser } = user;
    
    return createSuccessResponse(safeUser);
  } catch (error) {
    console.error('Get user error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to get user', 500);
  }
}

/**
 * 更新用户角色（仅管理员）
 */
export async function updateUserRole(
  request: Request,
  env: Env,
  ctx: any,
  context: Context,
  userId: string
): Promise<Response> {
  try {
    if (!context.user) {
      throw new ApiError('Authentication required', 401);
    }

    if (!hasPermission(context.user.role, 'admin')) {
      throw new ApiError('Insufficient permissions', 403);
    }

    const { role } = await parseJSON(request);
    
    if (!role || !['admin', 'collaborator', 'user'].includes(role)) {
      throw new ApiError('Invalid role', 400);
    }

    // 不能修改自己的角色
    if (context.user.id === userId) {
      throw new ApiError('Cannot modify your own role', 400);
    }

    const dbService = new DatabaseService(env.DB);
    
    // 检查用户是否存在
    const user = await dbService.getUserById(userId);
    if (!user) {
      throw new ApiError('User not found', 404);
    }

    // 更新用户角色
    await env.DB.prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?')
      .bind(role, new Date().toISOString(), userId)
      .run();

    // 获取更新后的用户信息
    const updatedUser = await dbService.getUserById(userId);
    
    return createSuccessResponse({
      user: updatedUser,
      message: 'User role updated successfully',
    });
  } catch (error) {
    console.error('Update user role error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to update user role', 500);
  }
}

/**
 * 禁用/启用用户（仅管理员）
 */
export async function toggleUserStatus(
  request: Request,
  env: Env,
  ctx: any,
  context: Context,
  userId: string
): Promise<Response> {
  try {
    if (!context.user) {
      throw new ApiError('Authentication required', 401);
    }

    if (!hasPermission(context.user.role, 'admin')) {
      throw new ApiError('Insufficient permissions', 403);
    }

    // 不能禁用自己
    if (context.user.id === userId) {
      throw new ApiError('Cannot disable your own account', 400);
    }

    const dbService = new DatabaseService(env.DB);
    
    // 检查用户是否存在
    const user = await dbService.getUserById(userId);
    if (!user) {
      throw new ApiError('User not found', 404);
    }

    const newStatus = !user.is_active;
    
    // 更新用户状态
    await env.DB.prepare('UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?')
      .bind(newStatus, new Date().toISOString(), userId)
      .run();

    return createSuccessResponse({
      message: `User ${newStatus ? 'enabled' : 'disabled'} successfully`,
      is_active: newStatus,
    });
  } catch (error) {
    console.error('Toggle user status error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to toggle user status', 500);
  }
}

/**
 * 获取用户统计信息
 */
export async function getUserStats(
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

    // 获取用户统计
    const totalUsersResult = await env.DB.prepare('SELECT COUNT(*) as count FROM users').first();
    const activeUsersResult = await env.DB.prepare('SELECT COUNT(*) as count FROM users WHERE is_active = true').first();
    const adminUsersResult = await env.DB.prepare('SELECT COUNT(*) as count FROM users WHERE role = ?').bind('admin').first();
    const collaboratorUsersResult = await env.DB.prepare('SELECT COUNT(*) as count FROM users WHERE role = ?').bind('collaborator').first();
    
    // 获取最近注册的用户
    const recentUsersResult = await env.DB.prepare(`
      SELECT id, username, name, email, role, created_at 
      FROM users 
      ORDER BY created_at DESC 
      LIMIT 10
    `).all();

    // 获取用户注册趋势（最近30天）
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const registrationTrendResult = await env.DB.prepare(`
      SELECT DATE(created_at) as date, COUNT(*) as count
      FROM users 
      WHERE created_at >= ?
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `).bind(thirtyDaysAgo).all();

    const stats = {
      total: totalUsersResult?.count || 0,
      active: activeUsersResult?.count || 0,
      inactive: (totalUsersResult?.count || 0) - (activeUsersResult?.count || 0),
      admins: adminUsersResult?.count || 0,
      collaborators: collaboratorUsersResult?.count || 0,
      users: (totalUsersResult?.count || 0) - (adminUsersResult?.count || 0) - (collaboratorUsersResult?.count || 0),
      recentUsers: recentUsersResult.results,
      registrationTrend: registrationTrendResult.results,
    };

    return createSuccessResponse(stats);
  } catch (error) {
    console.error('Get user stats error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to get user stats', 500);
  }
}

/**
 * 删除用户（仅管理员）
 */
export async function deleteUser(
  request: Request,
  env: Env,
  ctx: any,
  context: Context,
  userId: string
): Promise<Response> {
  try {
    if (!context.user) {
      throw new ApiError('Authentication required', 401);
    }

    if (!hasPermission(context.user.role, 'admin')) {
      throw new ApiError('Insufficient permissions', 403);
    }

    // 不能删除自己
    if (context.user.id === userId) {
      throw new ApiError('Cannot delete your own account', 400);
    }

    const dbService = new DatabaseService(env.DB);
    
    // 检查用户是否存在
    const user = await dbService.getUserById(userId);
    if (!user) {
      throw new ApiError('User not found', 404);
    }

    // 删除用户（级联删除会处理相关数据）
    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId).run();

    return createSuccessResponse({
      message: 'User deleted successfully',
    });
  } catch (error) {
    console.error('Delete user error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to delete user', 500);
  }
}
