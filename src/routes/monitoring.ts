import { Env, Context, ApiError } from '../types';
import { createSuccessResponse, createErrorResponse } from '../utils';
import { hasPermission } from '../utils/jwt';
import { getPerformanceMonitor } from '../utils/monitoring';
import { getLogger } from '../utils/logger';

/**
 * 获取性能指标
 */
export async function getPerformanceMetrics(
  request: Request,
  env: Env,
  ctx: any,
  context: Context
): Promise<Response> {
  try {
    if (!context.user || !hasPermission(context.user.role, 'admin')) {
      throw new ApiError('Insufficient permissions', 403);
    }

    const url = new URL(request.url);
    const metricName = url.searchParams.get('metric');
    const timeWindow = parseInt(url.searchParams.get('timeWindow') || '300000');

    const monitor = getPerformanceMonitor(env);

    if (metricName) {
      // 获取特定指标的统计信息
      const stats = monitor.getMetricStats(metricName, timeWindow);
      if (!stats) {
        throw new ApiError('Metric not found or no data available', 404);
      }

      return createSuccessResponse({
        metric: metricName,
        timeWindow,
        stats,
      });
    } else {
      // 获取所有指标名称
      const metricNames = monitor.getMetricNames();
      const metrics: Record<string, any> = {};

      for (const name of metricNames) {
        const stats = monitor.getMetricStats(name, timeWindow);
        if (stats) {
          metrics[name] = stats;
        }
      }

      return createSuccessResponse({
        timeWindow,
        metrics,
        metricNames,
      });
    }
  } catch (error) {
    console.error('Get performance metrics error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to get performance metrics', 500);
  }
}

/**
 * 获取健康检查状态
 */
export async function getHealthStatus(
  request: Request,
  env: Env,
  ctx: any,
  context: Context
): Promise<Response> {
  try {
    const monitor = getPerformanceMonitor(env);
    const healthCheck = await monitor.performHealthCheck();

    const statusCode = healthCheck.status === 'healthy' ? 200 :
                      healthCheck.status === 'degraded' ? 200 : 503;

    return new Response(JSON.stringify(healthCheck, null, 2), {
      status: statusCode,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error) {
    console.error('Health check error:', error);
    return new Response(JSON.stringify({
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: Date.now(),
    }), {
      status: 503,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
      },
    });
  }
}

/**
 * 获取系统日志
 */
export async function getSystemLogs(
  request: Request,
  env: Env,
  ctx: any,
  context: Context
): Promise<Response> {
  try {
    if (!context.user || !hasPermission(context.user.role, 'admin')) {
      throw new ApiError('Insufficient permissions', 403);
    }

    const url = new URL(request.url);
    const level = url.searchParams.get('level') || 'info';
    const limit = parseInt(url.searchParams.get('limit') || '100');
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const startTime = url.searchParams.get('startTime');
    const endTime = url.searchParams.get('endTime');

    // 这里应该从 Analytics Engine 或其他日志存储中查询日志
    // 由于这是示例，我们返回模拟数据
    const logs = [
      {
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'System started successfully',
        context: { component: 'system' },
      },
      {
        timestamp: new Date(Date.now() - 60000).toISOString(),
        level: 'warn',
        message: 'High response time detected',
        context: { component: 'monitoring', responseTime: 2500 },
      },
    ];

    return createSuccessResponse({
      logs,
      pagination: {
        limit,
        offset,
        total: logs.length,
      },
      filters: {
        level,
        startTime,
        endTime,
      },
    });
  } catch (error) {
    console.error('Get system logs error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to get system logs', 500);
  }
}

/**
 * 获取实时指标
 */
export async function getRealTimeMetrics(
  request: Request,
  env: Env,
  ctx: any,
  context: Context
): Promise<Response> {
  try {
    if (!context.user || !hasPermission(context.user.role, 'admin')) {
      throw new ApiError('Insufficient permissions', 403);
    }

    const monitor = getPerformanceMonitor(env);
    
    // 获取最近5分钟的关键指标
    const timeWindow = 300000; // 5分钟
    const metrics = {
      responseTime: monitor.getMetricStats('response_time', timeWindow),
      requestCount: monitor.getMetricStats('request_count', timeWindow),
      errorRate: monitor.getMetricStats('error_rate', timeWindow),
      dbQueryTime: monitor.getMetricStats('db_query_time', timeWindow),
    };

    // 获取健康状态
    const health = await monitor.performHealthCheck();

    return createSuccessResponse({
      timestamp: Date.now(),
      health: health.status,
      metrics,
      alerts: [], // 这里可以添加活跃告警
    });
  } catch (error) {
    console.error('Get real-time metrics error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to get real-time metrics', 500);
  }
}

/**
 * 获取告警历史
 */
export async function getAlertHistory(
  request: Request,
  env: Env,
  ctx: any,
  context: Context
): Promise<Response> {
  try {
    if (!context.user || !hasPermission(context.user.role, 'admin')) {
      throw new ApiError('Insufficient permissions', 403);
    }

    const url = new URL(request.url);
    const severity = url.searchParams.get('severity');
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const offset = parseInt(url.searchParams.get('offset') || '0');

    // 这里应该从数据库或日志存储中查询告警历史
    // 由于这是示例，我们返回模拟数据
    const alerts = [
      {
        id: '1',
        name: 'high_response_time',
        severity: 'high',
        message: 'Response time exceeded 5000ms',
        timestamp: new Date().toISOString(),
        resolved: false,
        metric: {
          name: 'response_time',
          value: 5500,
          unit: 'ms',
        },
      },
      {
        id: '2',
        name: 'database_slow_query',
        severity: 'medium',
        message: 'Database query took longer than expected',
        timestamp: new Date(Date.now() - 3600000).toISOString(),
        resolved: true,
        resolvedAt: new Date(Date.now() - 3000000).toISOString(),
        metric: {
          name: 'db_query_time',
          value: 1200,
          unit: 'ms',
        },
      },
    ];

    const filteredAlerts = severity 
      ? alerts.filter(alert => alert.severity === severity)
      : alerts;

    return createSuccessResponse({
      alerts: filteredAlerts.slice(offset, offset + limit),
      pagination: {
        limit,
        offset,
        total: filteredAlerts.length,
      },
      filters: {
        severity,
      },
    });
  } catch (error) {
    console.error('Get alert history error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to get alert history', 500);
  }
}

/**
 * 获取系统统计信息
 */
export async function getSystemStats(
  request: Request,
  env: Env,
  ctx: any,
  context: Context
): Promise<Response> {
  try {
    if (!context.user || !hasPermission(context.user.role, 'admin')) {
      throw new ApiError('Insufficient permissions', 403);
    }

    const monitor = getPerformanceMonitor(env);
    
    // 获取各种时间窗口的统计
    const timeWindows = {
      '1h': 3600000,
      '24h': 86400000,
      '7d': 604800000,
    };

    const stats: Record<string, any> = {};

    for (const [period, window] of Object.entries(timeWindows)) {
      stats[period] = {
        requests: monitor.getMetricStats('request_count', window),
        responseTime: monitor.getMetricStats('response_time', window),
        errorRate: monitor.getMetricStats('error_rate', window),
        dbQueries: monitor.getMetricStats('db_query_count', window),
      };
    }

    // 获取当前健康状态
    const health = await monitor.performHealthCheck();

    return createSuccessResponse({
      timestamp: Date.now(),
      health,
      stats,
      uptime: Date.now(), // 这里应该是实际的运行时间
    });
  } catch (error) {
    console.error('Get system stats error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to get system stats', 500);
  }
}

/**
 * 清理旧指标数据
 */
export async function cleanupMetrics(
  request: Request,
  env: Env,
  ctx: any,
  context: Context
): Promise<Response> {
  try {
    if (!context.user || !hasPermission(context.user.role, 'admin')) {
      throw new ApiError('Insufficient permissions', 403);
    }

    const { maxAge } = await request.json();
    const maxAgeMs = maxAge || 3600000; // 默认1小时

    const monitor = getPerformanceMonitor(env);
    monitor.cleanupOldMetrics(maxAgeMs);

    const logger = getLogger(env);
    await logger.info('Metrics cleanup completed', {
      maxAge: maxAgeMs,
      userId: context.user.id,
    });

    return createSuccessResponse({
      message: 'Metrics cleanup completed',
      maxAge: maxAgeMs,
    });
  } catch (error) {
    console.error('Cleanup metrics error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to cleanup metrics', 500);
  }
}

/**
 * 导出指标数据
 */
export async function exportMetrics(
  request: Request,
  env: Env,
  ctx: any,
  context: Context
): Promise<Response> {
  try {
    if (!context.user || !hasPermission(context.user.role, 'admin')) {
      throw new ApiError('Insufficient permissions', 403);
    }

    const url = new URL(request.url);
    const format = url.searchParams.get('format') || 'json';
    const timeWindow = parseInt(url.searchParams.get('timeWindow') || '86400000'); // 24小时

    const monitor = getPerformanceMonitor(env);
    const metricNames = monitor.getMetricNames();
    
    const exportData: Record<string, any> = {
      timestamp: new Date().toISOString(),
      timeWindow,
      metrics: {},
    };

    for (const name of metricNames) {
      const stats = monitor.getMetricStats(name, timeWindow);
      if (stats) {
        exportData.metrics[name] = stats;
      }
    }

    if (format === 'csv') {
      // 生成CSV格式
      let csv = 'metric,count,avg,min,max,p95,p99\n';
      for (const [name, stats] of Object.entries(exportData.metrics)) {
        const s = stats as any;
        csv += `${name},${s.count},${s.avg},${s.min},${s.max},${s.p95},${s.p99}\n`;
      }

      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="metrics-${Date.now()}.csv"`,
        },
      });
    } else {
      // 默认JSON格式
      return new Response(JSON.stringify(exportData, null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="metrics-${Date.now()}.json"`,
        },
      });
    }
  } catch (error) {
    console.error('Export metrics error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to export metrics', 500);
  }
}
