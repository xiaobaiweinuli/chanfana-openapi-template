import { Env } from '../types';
import { getLogger } from './logger';
import { getPerformanceMonitor } from './monitoring';

/**
 * 查询缓存配置
 */
interface QueryCacheConfig {
  ttl: number; // 缓存时间（秒）
  maxSize: number; // 最大缓存条目数
  enabled: boolean;
}

/**
 * 查询统计信息
 */
interface QueryStats {
  query: string;
  count: number;
  totalTime: number;
  avgTime: number;
  minTime: number;
  maxTime: number;
  lastExecuted: number;
}

/**
 * 数据库优化器
 */
export class DatabaseOptimizer {
  private env: Env;
  private logger: ReturnType<typeof getLogger>;
  private monitor: ReturnType<typeof getPerformanceMonitor>;
  private queryCache: Map<string, { data: any; expires: number }> = new Map();
  private queryStats: Map<string, QueryStats> = new Map();
  private cacheConfig: QueryCacheConfig;

  constructor(env: Env) {
    this.env = env;
    this.logger = getLogger(env);
    this.monitor = getPerformanceMonitor(env);
    this.cacheConfig = {
      ttl: 300, // 5分钟
      maxSize: 1000,
      enabled: env.NODE_ENV === 'production',
    };
  }

  /**
   * 执行优化的查询
   */
  async executeQuery<T = any>(
    query: string,
    params: any[] = [],
    options: {
      cache?: boolean;
      cacheTtl?: number;
      timeout?: number;
    } = {}
  ): Promise<T> {
    const startTime = Date.now();
    const cacheKey = this.generateCacheKey(query, params);
    const useCache = options.cache !== false && this.cacheConfig.enabled;

    try {
      // 检查缓存
      if (useCache) {
        const cached = this.getFromCache(cacheKey);
        if (cached) {
          await this.logger.debug('Query cache hit', { query, cacheKey });
          return cached;
        }
      }

      // 执行查询
      const statement = this.env.DB.prepare(query);
      let result: any;

      if (params.length > 0) {
        result = await statement.bind(...params).all();
      } else {
        result = await statement.all();
      }

      const duration = Date.now() - startTime;

      // 记录统计信息
      await this.recordQueryStats(query, duration, true);

      // 缓存结果
      if (useCache && this.shouldCache(query)) {
        const ttl = options.cacheTtl || this.cacheConfig.ttl;
        this.setCache(cacheKey, result, ttl);
      }

      await this.logger.debug('Query executed successfully', {
        query,
        duration,
        resultCount: result.results?.length || 0,
      });

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      await this.recordQueryStats(query, duration, false);
      
      await this.logger.error('Query execution failed', error as Error, {
        query,
        params,
        duration,
      });

      throw error;
    }
  }

  /**
   * 执行单行查询
   */
  async executeQueryFirst<T = any>(
    query: string,
    params: any[] = [],
    options: {
      cache?: boolean;
      cacheTtl?: number;
    } = {}
  ): Promise<T | null> {
    const startTime = Date.now();
    const cacheKey = this.generateCacheKey(query + '_first', params);
    const useCache = options.cache !== false && this.cacheConfig.enabled;

    try {
      // 检查缓存
      if (useCache) {
        const cached = this.getFromCache(cacheKey);
        if (cached !== undefined) {
          return cached;
        }
      }

      // 执行查询
      const statement = this.env.DB.prepare(query);
      let result: any;

      if (params.length > 0) {
        result = await statement.bind(...params).first();
      } else {
        result = await statement.first();
      }

      const duration = Date.now() - startTime;

      // 记录统计信息
      await this.recordQueryStats(query, duration, true);

      // 缓存结果
      if (useCache && this.shouldCache(query)) {
        const ttl = options.cacheTtl || this.cacheConfig.ttl;
        this.setCache(cacheKey, result, ttl);
      }

      return result || null;
    } catch (error) {
      const duration = Date.now() - startTime;
      await this.recordQueryStats(query, duration, false);
      
      await this.logger.error('Query first execution failed', error as Error, {
        query,
        params,
        duration,
      });

      throw error;
    }
  }

  /**
   * 执行批量查询
   */
  async executeBatch(statements: { query: string; params?: any[] }[]): Promise<any[]> {
    const startTime = Date.now();

    try {
      const preparedStatements = statements.map(stmt => {
        const prepared = this.env.DB.prepare(stmt.query);
        return stmt.params ? prepared.bind(...stmt.params) : prepared;
      });

      const results = await this.env.DB.batch(preparedStatements);
      const duration = Date.now() - startTime;

      // 记录批量查询统计
      await this.recordQueryStats('BATCH_QUERY', duration, true);
      await this.logger.info('Batch query executed', {
        statementCount: statements.length,
        duration,
      });

      return results;
    } catch (error) {
      const duration = Date.now() - startTime;
      await this.recordQueryStats('BATCH_QUERY', duration, false);
      
      await this.logger.error('Batch query execution failed', error as Error, {
        statementCount: statements.length,
        duration,
      });

      throw error;
    }
  }

  /**
   * 生成缓存键
   */
  private generateCacheKey(query: string, params: any[]): string {
    const normalizedQuery = query.replace(/\s+/g, ' ').trim();
    const paramsStr = JSON.stringify(params);
    return `query:${Buffer.from(normalizedQuery + paramsStr).toString('base64')}`;
  }

  /**
   * 从缓存获取数据
   */
  private getFromCache(key: string): any {
    const cached = this.queryCache.get(key);
    if (!cached) {
      return null;
    }

    if (Date.now() > cached.expires) {
      this.queryCache.delete(key);
      return null;
    }

    return cached.data;
  }

  /**
   * 设置缓存
   */
  private setCache(key: string, data: any, ttlSeconds: number): void {
    // 检查缓存大小限制
    if (this.queryCache.size >= this.cacheConfig.maxSize) {
      // 删除最旧的条目
      const oldestKey = this.queryCache.keys().next().value;
      if (oldestKey) {
        this.queryCache.delete(oldestKey);
      }
    }

    this.queryCache.set(key, {
      data,
      expires: Date.now() + (ttlSeconds * 1000),
    });
  }

  /**
   * 判断是否应该缓存查询
   */
  private shouldCache(query: string): boolean {
    const normalizedQuery = query.toLowerCase().trim();
    
    // 只缓存 SELECT 查询
    if (!normalizedQuery.startsWith('select')) {
      return false;
    }

    // 不缓存包含随机函数的查询
    if (normalizedQuery.includes('random()') || normalizedQuery.includes('now()')) {
      return false;
    }

    return true;
  }

  /**
   * 记录查询统计信息
   */
  private async recordQueryStats(query: string, duration: number, success: boolean): Promise<void> {
    const normalizedQuery = this.normalizeQuery(query);
    
    // 更新内存统计
    const existing = this.queryStats.get(normalizedQuery);
    if (existing) {
      existing.count++;
      existing.totalTime += duration;
      existing.avgTime = existing.totalTime / existing.count;
      existing.minTime = Math.min(existing.minTime, duration);
      existing.maxTime = Math.max(existing.maxTime, duration);
      existing.lastExecuted = Date.now();
    } else {
      this.queryStats.set(normalizedQuery, {
        query: normalizedQuery,
        count: 1,
        totalTime: duration,
        avgTime: duration,
        minTime: duration,
        maxTime: duration,
        lastExecuted: Date.now(),
      });
    }

    // 记录到监控系统
    await this.monitor.recordDatabaseQuery(normalizedQuery, duration, success);
  }

  /**
   * 标准化查询字符串
   */
  private normalizeQuery(query: string): string {
    return query
      .replace(/\s+/g, ' ')
      .replace(/\?/g, '?')
      .replace(/\d+/g, 'N')
      .replace(/'[^']*'/g, "'?'")
      .trim()
      .substring(0, 200); // 限制长度
  }

  /**
   * 获取查询统计信息
   */
  getQueryStats(): QueryStats[] {
    return Array.from(this.queryStats.values())
      .sort((a, b) => b.avgTime - a.avgTime);
  }

  /**
   * 获取慢查询
   */
  getSlowQueries(threshold: number = 1000): QueryStats[] {
    return this.getQueryStats()
      .filter(stat => stat.avgTime > threshold);
  }

  /**
   * 清理缓存
   */
  clearCache(): void {
    this.queryCache.clear();
    this.logger.info('Query cache cleared');
  }

  /**
   * 清理过期缓存
   */
  cleanupExpiredCache(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, cached] of this.queryCache.entries()) {
      if (now > cached.expires) {
        this.queryCache.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.debug('Cleaned up expired cache entries', { cleaned });
    }
  }

  /**
   * 获取缓存统计
   */
  getCacheStats(): {
    size: number;
    maxSize: number;
    hitRate: number;
    enabled: boolean;
  } {
    // 这里应该跟踪命中率，简化实现
    return {
      size: this.queryCache.size,
      maxSize: this.cacheConfig.maxSize,
      hitRate: 0, // 需要实现命中率跟踪
      enabled: this.cacheConfig.enabled,
    };
  }

  /**
   * 分析查询性能
   */
  analyzePerformance(): {
    totalQueries: number;
    avgResponseTime: number;
    slowQueries: QueryStats[];
    recommendations: string[];
  } {
    const stats = this.getQueryStats();
    const totalQueries = stats.reduce((sum, stat) => sum + stat.count, 0);
    const totalTime = stats.reduce((sum, stat) => sum + stat.totalTime, 0);
    const avgResponseTime = totalQueries > 0 ? totalTime / totalQueries : 0;
    const slowQueries = this.getSlowQueries();

    const recommendations: string[] = [];

    if (avgResponseTime > 500) {
      recommendations.push('考虑添加数据库索引以提高查询性能');
    }

    if (slowQueries.length > 0) {
      recommendations.push(`发现 ${slowQueries.length} 个慢查询，建议优化`);
    }

    if (this.queryCache.size > this.cacheConfig.maxSize * 0.8) {
      recommendations.push('查询缓存使用率较高，考虑增加缓存大小');
    }

    return {
      totalQueries,
      avgResponseTime,
      slowQueries,
      recommendations,
    };
  }
}

/**
 * 全局数据库优化器实例
 */
let globalOptimizer: DatabaseOptimizer | null = null;

/**
 * 获取数据库优化器实例
 */
export function getDatabaseOptimizer(env: Env): DatabaseOptimizer {
  if (!globalOptimizer) {
    globalOptimizer = new DatabaseOptimizer(env);
  }
  return globalOptimizer;
}

/**
 * 数据库查询装饰器
 */
export function optimizeQuery(
  cache: boolean = true,
  cacheTtl: number = 300
) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const optimizer = getDatabaseOptimizer((this as any).env);
      
      // 如果第一个参数是查询字符串，使用优化器
      if (typeof args[0] === 'string') {
        const [query, params = []] = args;
        return optimizer.executeQuery(query, params, { cache, cacheTtl });
      }
      
      // 否则使用原始方法
      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
}
