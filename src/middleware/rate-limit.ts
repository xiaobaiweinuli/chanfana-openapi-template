import { Env, ApiError } from '../types';

/**
 * 速率限制配置
 */
interface RateLimitConfig {
  windowMs: number; // 时间窗口（毫秒）
  maxRequests: number; // 最大请求数
  keyGenerator?: (request: Request) => string; // 自定义key生成器
  skipSuccessfulRequests?: boolean; // 是否跳过成功请求
  skipFailedRequests?: boolean; // 是否跳过失败请求
  message?: string; // 自定义错误消息
}

/**
 * 速率限制存储接口
 */
interface RateLimitStore {
  get(key: string): Promise<number | null>;
  set(key: string, value: number, ttl: number): Promise<void>;
  increment(key: string, ttl: number): Promise<number>;
  reset(key: string): Promise<void>;
}

/**
 * 内存存储实现（用于开发环境）
 */
class MemoryStore implements RateLimitStore {
  private store = new Map<string, { count: number; expiresAt: number }>();

  async get(key: string): Promise<number | null> {
    const entry = this.store.get(key);
    if (!entry || Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.count;
  }

  async set(key: string, value: number, ttl: number): Promise<void> {
    this.store.set(key, {
      count: value,
      expiresAt: Date.now() + ttl,
    });
  }

  async increment(key: string, ttl: number): Promise<number> {
    const current = await this.get(key);
    const newCount = (current || 0) + 1;
    await this.set(key, newCount, ttl);
    return newCount;
  }

  async reset(key: string): Promise<void> {
    this.store.delete(key);
  }

  // 清理过期条目
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
      }
    }
  }
}

/**
 * KV存储实现（用于生产环境）
 */
class KVStore implements RateLimitStore {
  constructor(private kv: any) {}

  async get(key: string): Promise<number | null> {
    const value = await this.kv.get(key);
    return value ? parseInt(value, 10) : null;
  }

  async set(key: string, value: number, ttl: number): Promise<void> {
    await this.kv.put(key, value.toString(), {
      expirationTtl: Math.ceil(ttl / 1000),
    });
  }

  async increment(key: string, ttl: number): Promise<number> {
    const current = await this.get(key);
    const newCount = (current || 0) + 1;
    await this.set(key, newCount, ttl);
    return newCount;
  }

  async reset(key: string): Promise<void> {
    await this.kv.delete(key);
  }
}

/**
 * 速率限制器
 */
export class RateLimiter {
  private store: RateLimitStore;
  private config: Required<RateLimitConfig>;

  constructor(config: RateLimitConfig, store?: RateLimitStore) {
    this.config = {
      windowMs: config.windowMs,
      maxRequests: config.maxRequests,
      keyGenerator: config.keyGenerator || this.defaultKeyGenerator,
      skipSuccessfulRequests: config.skipSuccessfulRequests || false,
      skipFailedRequests: config.skipFailedRequests || false,
      message: config.message || 'Too many requests, please try again later.',
    };
    
    this.store = store || new MemoryStore();
  }

  /**
   * 默认key生成器
   */
  private defaultKeyGenerator(request: Request): string {
    const ip = request.headers.get('CF-Connecting-IP') || 
               request.headers.get('X-Forwarded-For') || 
               request.headers.get('X-Real-IP') || 
               'unknown';
    return `rate_limit:${ip}`;
  }

  /**
   * 检查速率限制
   */
  async checkLimit(request: Request): Promise<{
    allowed: boolean;
    limit: number;
    remaining: number;
    resetTime: number;
  }> {
    const key = this.config.keyGenerator(request);
    const current = await this.store.increment(key, this.config.windowMs);
    
    const allowed = current <= this.config.maxRequests;
    const remaining = Math.max(0, this.config.maxRequests - current);
    const resetTime = Date.now() + this.config.windowMs;

    return {
      allowed,
      limit: this.config.maxRequests,
      remaining,
      resetTime,
    };
  }

  /**
   * 重置限制
   */
  async resetLimit(request: Request): Promise<void> {
    const key = this.config.keyGenerator(request);
    await this.store.reset(key);
  }
}

/**
 * 创建速率限制中间件
 */
export function createRateLimitMiddleware(config: RateLimitConfig, env?: Env) {
  const store = env?.RATE_LIMIT_KV ? new KVStore(env.RATE_LIMIT_KV) : new MemoryStore();
  const rateLimiter = new RateLimiter(config, store);

  return async (request: Request): Promise<Response | null> => {
    try {
      const result = await rateLimiter.checkLimit(request);

      // 添加速率限制头部
      const headers = new Headers();
      headers.set('X-RateLimit-Limit', result.limit.toString());
      headers.set('X-RateLimit-Remaining', result.remaining.toString());
      headers.set('X-RateLimit-Reset', Math.ceil(result.resetTime / 1000).toString());

      if (!result.allowed) {
        headers.set('Retry-After', Math.ceil(config.windowMs / 1000).toString());
        
        return new Response(JSON.stringify({
          error: config.message || 'Too many requests',
          code: 'RATE_LIMIT_EXCEEDED',
          limit: result.limit,
          remaining: result.remaining,
          resetTime: result.resetTime,
        }), {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            ...Object.fromEntries(headers.entries()),
          },
        });
      }

      // 将头部信息传递给后续处理
      (request as any).rateLimitHeaders = headers;
      return null; // 继续处理请求
    } catch (error) {
      console.error('Rate limit middleware error:', error);
      return null; // 出错时允许请求继续
    }
  };
}

/**
 * 预定义的速率限制配置
 */
export const RateLimitPresets = {
  /**
   * 严格限制（登录、注册等敏感操作）
   */
  strict: {
    windowMs: 15 * 60 * 1000, // 15分钟
    maxRequests: 5,
    message: 'Too many attempts, please try again in 15 minutes.',
  },

  /**
   * 中等限制（API调用）
   */
  moderate: {
    windowMs: 60 * 1000, // 1分钟
    maxRequests: 60,
    message: 'Too many requests, please slow down.',
  },

  /**
   * 宽松限制（一般浏览）
   */
  lenient: {
    windowMs: 60 * 1000, // 1分钟
    maxRequests: 200,
    message: 'Too many requests, please try again later.',
  },

  /**
   * 文件上传限制
   */
  upload: {
    windowMs: 60 * 1000, // 1分钟
    maxRequests: 10,
    message: 'Too many upload attempts, please wait before uploading again.',
  },

  /**
   * 搜索限制
   */
  search: {
    windowMs: 60 * 1000, // 1分钟
    maxRequests: 30,
    message: 'Too many search requests, please slow down.',
  },
};

/**
 * 基于用户角色的速率限制
 */
export function createRoleBasedRateLimit(env?: Env) {
  const guestLimiter = createRateLimitMiddleware(RateLimitPresets.lenient, env);
  const userLimiter = createRateLimitMiddleware({
    ...RateLimitPresets.moderate,
    maxRequests: 120, // 用户有更高限制
  }, env);
  const adminLimiter = createRateLimitMiddleware({
    ...RateLimitPresets.moderate,
    maxRequests: 300, // 管理员有最高限制
  }, env);

  return async (request: Request, userRole?: string): Promise<Response | null> => {
    switch (userRole) {
      case 'admin':
        return adminLimiter(request);
      case 'collaborator':
      case 'user':
        return userLimiter(request);
      default:
        return guestLimiter(request);
    }
  };
}

/**
 * IP白名单中间件
 */
export function createIPWhitelistMiddleware(whitelist: string[]) {
  return (request: Request): Response | null => {
    const ip = request.headers.get('CF-Connecting-IP') || 
               request.headers.get('X-Forwarded-For') || 
               request.headers.get('X-Real-IP');

    if (!ip || !whitelist.includes(ip)) {
      return new Response(JSON.stringify({
        error: 'Access denied',
        code: 'IP_NOT_WHITELISTED',
      }), {
        status: 403,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    }

    return null; // 允许继续
  };
}

/**
 * 地理位置限制中间件
 */
export function createGeoBlockMiddleware(blockedCountries: string[]) {
  return (request: Request): Response | null => {
    const country = (request as any).cf?.country;

    if (country && blockedCountries.includes(country)) {
      return new Response(JSON.stringify({
        error: 'Access denied from your location',
        code: 'GEO_BLOCKED',
        country,
      }), {
        status: 403,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    }

    return null; // 允许继续
  };
}
