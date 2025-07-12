import { Env } from '../types';
import { Logger, getLogger } from './logger';

/**
 * 性能指标接口
 */
interface PerformanceMetric {
  name: string;
  value: number;
  unit: string;
  timestamp: number;
  tags?: Record<string, string>;
}

/**
 * 健康检查结果
 */
interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: Record<string, {
    status: 'pass' | 'fail' | 'warn';
    message?: string;
    duration?: number;
    timestamp: number;
  }>;
  timestamp: number;
}

/**
 * 告警配置
 */
interface AlertConfig {
  name: string;
  condition: (metric: PerformanceMetric) => boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
  cooldown: number; // 冷却时间（毫秒）
  webhook?: string;
}

/**
 * 性能监控器
 */
export class PerformanceMonitor {
  private env: Env;
  private logger: Logger;
  private metrics: Map<string, PerformanceMetric[]> = new Map();
  private alerts: Map<string, number> = new Map(); // 告警冷却时间跟踪
  private alertConfigs: AlertConfig[] = [];

  constructor(env: Env) {
    this.env = env;
    this.logger = getLogger(env);
    this.setupDefaultAlerts();
  }

  /**
   * 设置默认告警规则
   */
  private setupDefaultAlerts(): void {
    this.alertConfigs = [
      {
        name: 'high_response_time',
        condition: (metric) => metric.name === 'response_time' && metric.value > 5000,
        severity: 'high',
        cooldown: 300000, // 5分钟
      },
      {
        name: 'high_error_rate',
        condition: (metric) => metric.name === 'error_rate' && metric.value > 0.05,
        severity: 'critical',
        cooldown: 600000, // 10分钟
      },
      {
        name: 'database_slow_query',
        condition: (metric) => metric.name === 'db_query_time' && metric.value > 1000,
        severity: 'medium',
        cooldown: 180000, // 3分钟
      },
      {
        name: 'memory_usage_high',
        condition: (metric) => metric.name === 'memory_usage' && metric.value > 0.8,
        severity: 'high',
        cooldown: 300000, // 5分钟
      },
    ];
  }

  /**
   * 记录性能指标
   */
  async recordMetric(
    name: string,
    value: number,
    unit: string = 'ms',
    tags?: Record<string, string>
  ): Promise<void> {
    const metric: PerformanceMetric = {
      name,
      value,
      unit,
      timestamp: Date.now(),
      tags,
    };

    // 存储到内存中（用于短期分析）
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }
    
    const metricHistory = this.metrics.get(name)!;
    metricHistory.push(metric);
    
    // 保留最近1000个指标
    if (metricHistory.length > 1000) {
      metricHistory.shift();
    }

    // 发送到 Analytics Engine
    if (this.env.ANALYTICS) {
      try {
        await this.env.ANALYTICS.writeDataPoint({
          blobs: [
            name,
            unit,
            JSON.stringify(tags || {}),
          ],
          doubles: [value],
          indexes: [new Date().toISOString()],
        });
      } catch (error) {
        await this.logger.error('Failed to write metric to Analytics Engine', error as Error);
      }
    }

    // 检查告警
    await this.checkAlerts(metric);

    // 记录到日志
    await this.logger.logPerformance(name, value, { unit, tags });
  }

  /**
   * 检查告警条件
   */
  private async checkAlerts(metric: PerformanceMetric): Promise<void> {
    for (const alertConfig of this.alertConfigs) {
      if (alertConfig.condition(metric)) {
        const lastAlert = this.alerts.get(alertConfig.name) || 0;
        const now = Date.now();
        
        // 检查冷却时间
        if (now - lastAlert > alertConfig.cooldown) {
          await this.triggerAlert(alertConfig, metric);
          this.alerts.set(alertConfig.name, now);
        }
      }
    }
  }

  /**
   * 触发告警
   */
  private async triggerAlert(config: AlertConfig, metric: PerformanceMetric): Promise<void> {
    const alertMessage = `Alert: ${config.name} - ${metric.name} = ${metric.value}${metric.unit}`;
    
    await this.logger.logSecurity(alertMessage, config.severity, {
      alert: config.name,
      metric: metric.name,
      value: metric.value,
      unit: metric.unit,
      tags: metric.tags,
    });

    // 发送 Webhook 通知
    if (config.webhook) {
      try {
        await fetch(config.webhook, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            alert: config.name,
            severity: config.severity,
            message: alertMessage,
            metric,
            timestamp: new Date().toISOString(),
          }),
        });
      } catch (error) {
        await this.logger.error('Failed to send alert webhook', error as Error);
      }
    }
  }

  /**
   * 获取指标统计
   */
  getMetricStats(name: string, timeWindow: number = 300000): {
    count: number;
    avg: number;
    min: number;
    max: number;
    p95: number;
    p99: number;
  } | null {
    const metrics = this.metrics.get(name);
    if (!metrics || metrics.length === 0) {
      return null;
    }

    const now = Date.now();
    const recentMetrics = metrics.filter(m => now - m.timestamp <= timeWindow);
    
    if (recentMetrics.length === 0) {
      return null;
    }

    const values = recentMetrics.map(m => m.value).sort((a, b) => a - b);
    const count = values.length;
    const sum = values.reduce((a, b) => a + b, 0);
    
    return {
      count,
      avg: sum / count,
      min: values[0],
      max: values[count - 1],
      p95: values[Math.floor(count * 0.95)],
      p99: values[Math.floor(count * 0.99)],
    };
  }

  /**
   * 执行健康检查
   */
  async performHealthCheck(): Promise<HealthCheckResult> {
    const checks: HealthCheckResult['checks'] = {};
    let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    // 数据库健康检查
    const dbCheckStart = Date.now();
    try {
      await this.env.DB.prepare('SELECT 1').first();
      checks.database = {
        status: 'pass',
        message: 'Database connection successful',
        duration: Date.now() - dbCheckStart,
        timestamp: Date.now(),
      };
    } catch (error) {
      checks.database = {
        status: 'fail',
        message: `Database connection failed: ${(error as Error).message}`,
        duration: Date.now() - dbCheckStart,
        timestamp: Date.now(),
      };
      overallStatus = 'unhealthy';
    }

    // R2 存储健康检查
    if (this.env.R2_BUCKET) {
      const r2CheckStart = Date.now();
      try {
        const testKey = `health-check-${Date.now()}`;
        await this.env.R2_BUCKET.put(testKey, 'test');
        await this.env.R2_BUCKET.delete(testKey);
        checks.storage = {
          status: 'pass',
          message: 'R2 storage accessible',
          duration: Date.now() - r2CheckStart,
          timestamp: Date.now(),
        };
      } catch (error) {
        checks.storage = {
          status: 'fail',
          message: `R2 storage failed: ${(error as Error).message}`,
          duration: Date.now() - r2CheckStart,
          timestamp: Date.now(),
        };
        if (overallStatus === 'healthy') {
          overallStatus = 'degraded';
        }
      }
    }

    // 响应时间检查
    const responseTimeStats = this.getMetricStats('response_time', 300000);
    if (responseTimeStats) {
      if (responseTimeStats.avg > 2000) {
        checks.response_time = {
          status: 'warn',
          message: `Average response time is high: ${responseTimeStats.avg.toFixed(2)}ms`,
          timestamp: Date.now(),
        };
        if (overallStatus === 'healthy') {
          overallStatus = 'degraded';
        }
      } else {
        checks.response_time = {
          status: 'pass',
          message: `Average response time: ${responseTimeStats.avg.toFixed(2)}ms`,
          timestamp: Date.now(),
        };
      }
    }

    // 错误率检查
    const errorRateStats = this.getMetricStats('error_rate', 300000);
    if (errorRateStats && errorRateStats.avg > 0.01) {
      checks.error_rate = {
        status: 'warn',
        message: `Error rate is elevated: ${(errorRateStats.avg * 100).toFixed(2)}%`,
        timestamp: Date.now(),
      };
      if (overallStatus === 'healthy') {
        overallStatus = 'degraded';
      }
    }

    return {
      status: overallStatus,
      checks,
      timestamp: Date.now(),
    };
  }

  /**
   * 记录请求指标
   */
  async recordRequest(
    request: Request,
    response: Response,
    duration: number
  ): Promise<void> {
    const url = new URL(request.url);
    const tags = {
      method: request.method,
      status: response.status.toString(),
      endpoint: url.pathname,
    };

    // 记录响应时间
    await this.recordMetric('response_time', duration, 'ms', tags);

    // 记录请求计数
    await this.recordMetric('request_count', 1, 'count', tags);

    // 记录错误率
    const isError = response.status >= 400;
    await this.recordMetric('error_rate', isError ? 1 : 0, 'rate', tags);

    // 记录状态码分布
    await this.recordMetric(`status_${response.status}`, 1, 'count', tags);
  }

  /**
   * 记录数据库查询指标
   */
  async recordDatabaseQuery(
    query: string,
    duration: number,
    success: boolean
  ): Promise<void> {
    const tags = {
      query_type: this.getQueryType(query),
      success: success.toString(),
    };

    await this.recordMetric('db_query_time', duration, 'ms', tags);
    await this.recordMetric('db_query_count', 1, 'count', tags);
    
    if (!success) {
      await this.recordMetric('db_query_error', 1, 'count', tags);
    }
  }

  /**
   * 获取查询类型
   */
  private getQueryType(query: string): string {
    const normalizedQuery = query.trim().toLowerCase();
    if (normalizedQuery.startsWith('select')) return 'select';
    if (normalizedQuery.startsWith('insert')) return 'insert';
    if (normalizedQuery.startsWith('update')) return 'update';
    if (normalizedQuery.startsWith('delete')) return 'delete';
    if (normalizedQuery.startsWith('create')) return 'create';
    if (normalizedQuery.startsWith('drop')) return 'drop';
    if (normalizedQuery.startsWith('alter')) return 'alter';
    return 'other';
  }

  /**
   * 获取所有指标名称
   */
  getMetricNames(): string[] {
    return Array.from(this.metrics.keys());
  }

  /**
   * 清理旧指标
   */
  cleanupOldMetrics(maxAge: number = 3600000): void {
    const cutoff = Date.now() - maxAge;
    
    for (const [name, metrics] of this.metrics.entries()) {
      const filteredMetrics = metrics.filter(m => m.timestamp > cutoff);
      this.metrics.set(name, filteredMetrics);
    }
  }
}

/**
 * 性能监控中间件
 */
export function createPerformanceMiddleware(monitor: PerformanceMonitor) {
  return async (
    request: Request,
    handler: () => Promise<Response>
  ): Promise<Response> => {
    const startTime = Date.now();
    
    try {
      const response = await handler();
      const duration = Date.now() - startTime;
      
      await monitor.recordRequest(request, response, duration);
      
      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // 创建错误响应用于指标记录
      const errorResponse = new Response('Internal Server Error', { status: 500 });
      await monitor.recordRequest(request, errorResponse, duration);
      
      throw error;
    }
  };
}

/**
 * 数据库监控装饰器
 */
export function monitorDatabase(monitor: PerformanceMonitor) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const startTime = Date.now();
      let success = true;
      
      try {
        const result = await originalMethod.apply(this, args);
        return result;
      } catch (error) {
        success = false;
        throw error;
      } finally {
        const duration = Date.now() - startTime;
        const query = args[0] || 'unknown';
        await monitor.recordDatabaseQuery(query, duration, success);
      }
    };

    return descriptor;
  };
}

/**
 * 全局性能监控器实例
 */
let globalMonitor: PerformanceMonitor | null = null;

/**
 * 获取性能监控器实例
 */
export function getPerformanceMonitor(env: Env): PerformanceMonitor {
  if (!globalMonitor) {
    globalMonitor = new PerformanceMonitor(env);
  }
  return globalMonitor;
}
