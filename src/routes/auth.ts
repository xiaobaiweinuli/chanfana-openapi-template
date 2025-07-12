import { Env, Context, ApiError } from '../types';
import { GitHubService } from '../services/github';
import { DatabaseService } from '../services/database';
import { JWT } from '../utils/jwt';
import { createSuccessResponse, createErrorResponse, parseJSON, safeJsonParse } from '../utils';

/**
 * GitHub OAuth 回调处理
 */
export async function handleGitHubCallback(
  request: Request,
  env: Env,
  _ctx: any
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    // const state = url.searchParams.get('state'); // 暂时未使用
    
    if (!code) {
      throw new ApiError('Authorization code is required', 400);
    }

    // 初始化服务
    const githubService = new GitHubService(env.GITHUB_CLIENT_SECRET, env.FRONTEND_URL);
    const dbService = new DatabaseService(env.DB);
    const jwt = new JWT(env.JWT_SECRET);
    
    // 获取管理员邮箱列表
    const adminEmails = safeJsonParse(env.ADMIN_EMAILS, []);
    
    // 执行 GitHub OAuth 认证
    const { user: githubUser, role } = await githubService.authenticateUser(code, adminEmails);
    
    // 创建或更新用户
    const user = await dbService.upsertUser({
      github_id: githubUser.id,
      username: githubUser.login,
      email: githubUser.email,
      name: githubUser.name,
      avatar_url: githubUser.avatar_url,
      bio: githubUser.bio,
      location: githubUser.location,
      website: githubUser.blog,
      role,
    });
    
    // 生成 JWT Token
    const token = await jwt.generateUserToken(user);
    
    // 存储会话到 KV（可选）
    const sessionId = crypto.randomUUID();
    await env.SESSIONS.put(sessionId, JSON.stringify({
      userId: user.id,
      token,
      createdAt: new Date().toISOString(),
      userAgent: request.headers.get('User-Agent'),
    }), { expirationTtl: 7 * 24 * 60 * 60 }); // 7 天过期
    
    return createSuccessResponse({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        name: user.name,
        avatar_url: user.avatar_url,
        role: user.role,
      },
      token,
      sessionId,
    });
  } catch (error) {
    console.error('GitHub callback error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Authentication failed', 500);
  }
}

/**
 * 获取 GitHub OAuth 授权 URL
 */
export async function getGitHubAuthUrl(
  _request: Request,
  env: Env,
  _ctx: any
): Promise<Response> {
  try {
    const githubService = new GitHubService(env.GITHUB_CLIENT_SECRET, env.FRONTEND_URL);
    const state = crypto.randomUUID();
    
    // 存储 state 到 KV 用于验证
    await env.CACHE.put(`oauth_state_${state}`, 'valid', { expirationTtl: 600 }); // 10 分钟过期
    
    const authUrl = githubService.getAuthUrl(state);
    
    return createSuccessResponse({
      authUrl,
      state,
    });
  } catch (error) {
    console.error('Get auth URL error:', error);
    return createErrorResponse('Failed to generate auth URL', 500);
  }
}

/**
 * 验证 JWT Token
 */
export async function verifyToken(
  request: Request,
  env: Env,
  _ctx: any
): Promise<Response> {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new ApiError('Authorization header is required', 401);
    }
    
    const token = authHeader.slice(7);
    const jwt = new JWT(env.JWT_SECRET);
    const payload = await jwt.verify(token);
    
    // 获取用户信息
    const dbService = new DatabaseService(env.DB);
    const user = await dbService.getUserById(payload.userId);
    
    if (!user || !user.is_active) {
      throw new ApiError('User not found or inactive', 401);
    }
    
    return createSuccessResponse({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        name: user.name,
        avatar_url: user.avatar_url,
        role: user.role,
      },
      payload,
    });
  } catch (error) {
    console.error('Token verification error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Token verification failed', 401);
  }
}

/**
 * 刷新 Token
 */
export async function refreshToken(
  request: Request,
  env: Env,
  _ctx: any
): Promise<Response> {
  try {
    const { refreshToken: oldToken } = await parseJSON(request);
    
    if (!oldToken) {
      throw new ApiError('Refresh token is required', 400);
    }
    
    const jwt = new JWT(env.JWT_SECRET);
    const payload = await jwt.verify(oldToken);
    
    // 获取用户信息
    const dbService = new DatabaseService(env.DB);
    const user = await dbService.getUserById(payload.userId);
    
    if (!user || !user.is_active) {
      throw new ApiError('User not found or inactive', 401);
    }
    
    // 生成新的 Token
    const newToken = await jwt.generateUserToken(user);
    
    return createSuccessResponse({
      token: newToken,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        name: user.name,
        avatar_url: user.avatar_url,
        role: user.role,
      },
    });
  } catch (error) {
    console.error('Token refresh error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Token refresh failed', 401);
  }
}

/**
 * 登出
 */
export async function logout(
  request: Request,
  env: Env,
  _ctx: any,
  _context: Context
): Promise<Response> {
  try {
    const { sessionId } = await parseJSON(request);
    
    // 从 KV 中删除会话
    if (sessionId) {
      await env.SESSIONS.delete(sessionId);
    }
    
    // 可以在这里添加 Token 黑名单逻辑
    
    return createSuccessResponse({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    return createErrorResponse('Logout failed', 500);
  }
}

/**
 * 获取当前用户信息
 */
export async function getCurrentUser(
  _request: Request,
  _env: Env,
  _ctx: any,
  context: Context
): Promise<Response> {
  try {
    if (!context.user) {
      throw new ApiError('User not authenticated', 401);
    }
    
    return createSuccessResponse({
      user: {
        id: context.user.id,
        username: context.user.username,
        email: context.user.email,
        name: context.user.name,
        avatar_url: context.user.avatar_url,
        role: context.user.role,
        bio: context.user.bio,
        location: context.user.location,
        website: context.user.website,
        created_at: context.user.created_at,
      },
    });
  } catch (error) {
    console.error('Get current user error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to get user info', 500);
  }
}

/**
 * 更新用户信息
 */
export async function updateUser(
  request: Request,
  env: Env,
  _ctx: any,
  context: Context
): Promise<Response> {
  try {
    if (!context.user) {
      throw new ApiError('User not authenticated', 401);
    }
    
    const updateData = await parseJSON(request);
    const dbService = new DatabaseService(env.DB);
    
    // 只允许更新特定字段
    const allowedFields = ['name', 'bio', 'location', 'website'];
    const filteredData = Object.keys(updateData)
      .filter(key => allowedFields.includes(key))
      .reduce((obj, key) => {
        obj[key] = updateData[key];
        return obj;
      }, {} as any);
    
    if (Object.keys(filteredData).length === 0) {
      throw new ApiError('No valid fields to update', 400);
    }
    
    // 更新用户信息
    const updatedUser = await dbService.upsertUser({
      ...context.user,
      ...filteredData,
    });
    
    return createSuccessResponse({
      user: {
        id: updatedUser.id,
        username: updatedUser.username,
        email: updatedUser.email,
        name: updatedUser.name,
        avatar_url: updatedUser.avatar_url,
        role: updatedUser.role,
        bio: updatedUser.bio,
        location: updatedUser.location,
        website: updatedUser.website,
      },
    });
  } catch (error) {
    console.error('Update user error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to update user', 500);
  }
}
