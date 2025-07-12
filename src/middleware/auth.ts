import { Env, Context, User, ApiError } from '../types';
import { JWT, extractTokenFromHeader, hasPermission } from '../utils/jwt';
import { DatabaseService } from '../services/database';

/**
 * 认证中间件
 */
export async function authMiddleware(
  request: Request,
  env: Env,
  ctx: any,
  context: Context
): Promise<Context> {
  // 首先尝试从 Authorization header 获取 token
  const token = extractTokenFromHeader(request);

  if (token) {
    try {
      const jwt = new JWT(env.JWT_SECRET);
      const payload = await jwt.verify(token);

      // 获取用户信息
      const dbService = new DatabaseService(env.DB);
      const user = await dbService.getUserById(payload.userId);

      if (user && user.is_active) {
        return {
          ...context,
          user,
        };
      }
    } catch (error) {
      console.error('JWT auth error:', error);
    }
  }

  // 如果 JWT 认证失败，尝试从 cookie 获取会话
  try {
    const { validateSessionFromCookie } = await import('../routes/nextauth-compat');
    const user = await validateSessionFromCookie(request, env);

    if (user) {
      return {
        ...context,
        user,
      };
    }
  } catch (error) {
    console.error('Cookie auth error:', error);
  }

  return context; // 不抛出错误，让路由处理器决定是否需要认证
}

/**
 * 要求认证的中间件
 */
export function requireAuth(
  handler: (request: Request, env: Env, ctx: any, context: Context) => Promise<Response>
) {
  return async (
    request: Request,
    env: Env,
    ctx: any,
    context: Context
  ): Promise<Response> => {
    if (!context.user) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Authentication required',
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    return handler(request, env, ctx, context);
  };
}

/**
 * 要求特定角色的中间件
 */
export function requireRole(
  role: 'admin' | 'collaborator' | 'user',
  handler: (request: Request, env: Env, ctx: any, context: Context) => Promise<Response>
) {
  return async (
    request: Request,
    env: Env,
    ctx: any,
    context: Context
  ): Promise<Response> => {
    if (!context.user) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Authentication required',
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    if (!hasPermission(context.user.role, role)) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Insufficient permissions',
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    return handler(request, env, ctx, context);
  };
}

/**
 * 速率限制中间件
 */
export async function rateLimitMiddleware(
  request: Request,
  env: Env,
  ctx: any,
  context: Context,
  options: {
    windowMs: number; // 时间窗口（毫秒）
    maxRequests: number; // 最大请求数
    keyGenerator?: (request: Request, context: Context) => string;
  }
): Promise<Context> {
  const { windowMs, maxRequests, keyGenerator } = options;
  
  // 生成限制键
  const key = keyGenerator 
    ? keyGenerator(request, context)
    : `rate_limit_${request.headers.get('CF-Connecting-IP') || 'unknown'}`;
  
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const rateLimitKey = `${key}_${windowStart}`;
  
  // 获取当前计数
  const currentCount = await env.CACHE.get(rateLimitKey);
  const count = currentCount ? parseInt(currentCount) : 0;
  
  if (count >= maxRequests) {
    throw new ApiError('Rate limit exceeded', 429);
  }
  
  // 增加计数
  await env.CACHE.put(rateLimitKey, (count + 1).toString(), {
    expirationTtl: Math.ceil(windowMs / 1000),
  });
  
  return context;
}

/**
 * CORS 中间件
 */
export function corsMiddleware(allowedOrigins: string[] = ['*']) {
  return (request: Request): Headers => {
    const headers = new Headers();
    const origin = request.headers.get('Origin');
    
    // 检查是否允许该来源
    if (origin && (allowedOrigins.includes(origin) || allowedOrigins.includes('*'))) {
      headers.set('Access-Control-Allow-Origin', origin);
    }
    
    headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    headers.set('Access-Control-Max-Age', '86400');
    
    return headers;
  };
}

/**
 * 日志中间件
 */
export async function loggingMiddleware(
  request: Request,
  env: Env,
  ctx: any,
  context: Context
): Promise<Context> {
  const startTime = Date.now();
  const requestId = crypto.randomUUID();
  
  // 记录请求信息
  console.log(`[${requestId}] ${request.method} ${request.url} - Start`);
  
  // 在响应完成后记录
  ctx.waitUntil(
    (async () => {
      const duration = Date.now() - startTime;
      console.log(`[${requestId}] ${request.method} ${request.url} - ${duration}ms`);
    })()
  );
  
  return {
    ...context,
    requestId,
  };
}
