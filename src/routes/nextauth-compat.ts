import { Env, Context, ApiError } from '../types';
import { GitHubService } from '../services/github';
import { DatabaseService } from '../services/database';
import { JWT } from '../utils/jwt';
import { createSuccessResponse, createErrorResponse, safeJsonParse } from '../utils';

/**
 * NextAuth 兼容性适配器
 * 提供与 NextAuth.js 兼容的 API 端点
 */

/**
 * 获取会话信息 (兼容 NextAuth.js)
 */
export async function getSession(
  request: Request,
  env: Env,
  ctx: any,
  context: Context
): Promise<Response> {
  try {
    if (!context.user) {
      return createSuccessResponse(null);
    }

    // 返回 NextAuth 格式的会话数据
    const session = {
      user: {
        id: context.user.id,
        name: context.user.name,
        email: context.user.email,
        image: context.user.avatar_url,
        role: context.user.role,
      },
      expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 天后过期
    };

    return createSuccessResponse(session);
  } catch (error) {
    console.error('Get session error:', error);
    return createSuccessResponse(null);
  }
}

/**
 * 获取 CSRF Token (兼容 NextAuth.js)
 */
export async function getCsrfToken(
  request: Request,
  env: Env,
  ctx: any
): Promise<Response> {
  try {
    // 生成 CSRF token
    const csrfToken = crypto.randomUUID();
    
    // 存储到 KV (短期有效)
    await env.CACHE.put(`csrf_${csrfToken}`, 'valid', { expirationTtl: 3600 }); // 1小时过期
    
    return createSuccessResponse({ csrfToken });
  } catch (error) {
    console.error('Get CSRF token error:', error);
    return createErrorResponse('Failed to generate CSRF token', 500);
  }
}

/**
 * 获取提供者信息 (兼容 NextAuth.js)
 */
export async function getProviders(
  request: Request,
  env: Env,
  ctx: any
): Promise<Response> {
  try {
    const providers = {
      github: {
        id: 'github',
        name: 'GitHub',
        type: 'oauth',
        signinUrl: '/api/auth/signin/github',
        callbackUrl: '/api/auth/callback/github',
      },
    };

    return createSuccessResponse(providers);
  } catch (error) {
    console.error('Get providers error:', error);
    return createErrorResponse('Failed to get providers', 500);
  }
}

/**
 * GitHub 登录页面 (兼容 NextAuth.js)
 */
export async function signInGitHub(
  request: Request,
  env: Env,
  ctx: any
): Promise<Response> {
  try {
    const githubService = new GitHubService(env.GITHUB_CLIENT_SECRET, env.FRONTEND_URL);
    const state = crypto.randomUUID();
    
    // 存储 state 到 KV 用于验证
    await env.CACHE.put(`oauth_state_${state}`, 'valid', { expirationTtl: 600 }); // 10 分钟过期
    
    const authUrl = githubService.getAuthUrl(state);
    
    // 重定向到 GitHub OAuth
    return new Response(null, {
      status: 302,
      headers: {
        'Location': authUrl,
      },
    });
  } catch (error) {
    console.error('GitHub sign in error:', error);
    return createErrorResponse('Failed to initiate GitHub sign in', 500);
  }
}

/**
 * GitHub OAuth 回调 (兼容 NextAuth.js)
 */
export async function callbackGitHub(
  request: Request,
  env: Env,
  ctx: any
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');
    
    if (error) {
      // 重定向到错误页面
      return new Response(null, {
        status: 302,
        headers: {
          'Location': `${env.FRONTEND_URL}/auth/error?error=${encodeURIComponent(error)}`,
        },
      });
    }
    
    if (!code) {
      return new Response(null, {
        status: 302,
        headers: {
          'Location': `${env.FRONTEND_URL}/auth/error?error=missing_code`,
        },
      });
    }

    // 验证 state
    if (state) {
      const storedState = await env.CACHE.get(`oauth_state_${state}`);
      if (!storedState) {
        return new Response(null, {
          status: 302,
          headers: {
            'Location': `${env.FRONTEND_URL}/auth/error?error=invalid_state`,
          },
        });
      }
      // 删除已使用的 state
      await env.CACHE.delete(`oauth_state_${state}`);
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
    
    // 创建会话 cookie
    const sessionCookie = `next-auth.session-token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}`;
    
    // 重定向到前端
    const callbackUrl = url.searchParams.get('callbackUrl') || '/';
    
    return new Response(null, {
      status: 302,
      headers: {
        'Location': `${env.FRONTEND_URL}${callbackUrl}`,
        'Set-Cookie': sessionCookie,
      },
    });
  } catch (error) {
    console.error('GitHub callback error:', error);
    return new Response(null, {
      status: 302,
      headers: {
        'Location': `${env.FRONTEND_URL}/auth/error?error=callback_error`,
      },
    });
  }
}

/**
 * 登出 (兼容 NextAuth.js)
 */
export async function signOut(
  request: Request,
  env: Env,
  ctx: any
): Promise<Response> {
  try {
    // 清除会话 cookie
    const clearCookie = 'next-auth.session-token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
    
    // 如果是 POST 请求，返回 JSON
    if (request.method === 'POST') {
      return new Response(JSON.stringify({ url: `${env.FRONTEND_URL}/` }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': clearCookie,
        },
      });
    }
    
    // 如果是 GET 请求，重定向
    return new Response(null, {
      status: 302,
      headers: {
        'Location': `${env.FRONTEND_URL}/`,
        'Set-Cookie': clearCookie,
      },
    });
  } catch (error) {
    console.error('Sign out error:', error);
    return createErrorResponse('Sign out failed', 500);
  }
}

/**
 * 验证会话 token (从 cookie 中提取)
 */
export async function validateSessionFromCookie(
  request: Request,
  env: Env
): Promise<any> {
  try {
    const cookieHeader = request.headers.get('Cookie');
    if (!cookieHeader) return null;
    
    // 解析 cookie
    const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
      const [key, value] = cookie.trim().split('=');
      acc[key] = value;
      return acc;
    }, {} as Record<string, string>);
    
    const sessionToken = cookies['next-auth.session-token'];
    if (!sessionToken) return null;
    
    // 验证 JWT
    const jwt = new JWT(env.JWT_SECRET);
    const payload = await jwt.verify(sessionToken);
    
    // 获取用户信息
    const dbService = new DatabaseService(env.DB);
    const user = await dbService.getUserById(payload.userId);
    
    if (!user || !user.is_active) return null;
    
    return user;
  } catch (error) {
    console.error('Validate session from cookie error:', error);
    return null;
  }
}
