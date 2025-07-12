import { Env, Context, ApiError } from '../types';
import { createSuccessResponse, createErrorResponse } from '../utils';
import { hasPermission } from '../utils/jwt';
import {
  getDatabaseHealth,
  DatabaseMigration,
  DatabaseBackup
} from '../utils/database';

/**
 * 系统健康检查
 */
export async function getSystemHealth(
  _request: Request,
  env: Env,
  _ctx: any,
  _context: Context
): Promise<Response> {
  try {
    const startTime = Date.now();

    // 基础健康检查
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      environment: env.NODE_ENV || 'development',
      uptime: Date.now() - startTime,
      checks: {
        database: { status: 'unknown' as 'healthy' | 'unhealthy' | 'unknown' },
        storage: { status: 'unknown' as 'healthy' | 'unhealthy' | 'unknown' },
        auth: { status: 'unknown' as 'healthy' | 'unhealthy' | 'unknown' },
      },
    };

    // 数据库健康检查
    try {
      const dbHealth = await getDatabaseHealth(env);
      health.checks.database = {
        status: dbHealth.connected ? 'healthy' : 'unhealthy',
        connected: dbHealth.connected,
        tablesCount: dbHealth.tablesCount,
        lastBackup: dbHealth.lastBackup,
        error: dbHealth.error,
      } as any;
    } catch (error) {
      health.checks.database = {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error',
      } as any;
    }

    // 存储健康检查
    try {
      if (env.R2_BUCKET) {
        // 尝试写入一个测试文件
        const testKey = `health-check-${Date.now()}`;
        await env.R2_BUCKET.put(testKey, 'test');
        await env.R2_BUCKET.delete(testKey);
        health.checks.storage = { status: 'healthy' };
      } else {
        (health.checks.storage as any) = { status: 'unhealthy', error: 'R2 bucket not configured' };
      }
    } catch (error) {
      health.checks.storage = {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error',
      } as any;
    }

    // 认证健康检查
    try {
      if (env.JWT_SECRET) {
        health.checks.auth = { status: 'healthy' };
      } else {
        (health.checks.auth as any) = { status: 'unhealthy', error: 'JWT secret not configured' };
      }
    } catch (error) {
      health.checks.auth = {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error',
      } as any;
    }

    // 确定整体状态
    const hasUnhealthy = Object.values(health.checks).some(check => check.status === 'unhealthy');
    health.status = hasUnhealthy ? 'unhealthy' : 'healthy';

    const responseStatus = health.status === 'healthy' ? 200 : 503;
    
    return new Response(JSON.stringify(health, null, 2), {
      status: responseStatus,
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
      timestamp: new Date().toISOString(),
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
 * 详细的系统状态（需要管理员权限）
 */
export async function getDetailedSystemStatus(
  request: Request,
  env: Env,
  _ctx: any,
  context: Context
): Promise<Response> {
  try {
    if (!context.user || !hasPermission(context.user.role, 'admin')) {
      throw new ApiError('Insufficient permissions', 403);
    }

    const migration = new DatabaseMigration(env);
    // const backup = new DatabaseBackup(env); // 暂时未使用

    // 获取详细状态
    const status = {
      system: {
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        environment: env.NODE_ENV || 'development',
        region: (request as any).cf?.colo || 'unknown',
        country: (request as any).cf?.country || 'unknown',
      },
      database: await getDatabaseHealth(env),
      migration: {
        currentVersion: await migration.getCurrentVersion(),
        latestVersion: 3, // 应该从迁移类获取
      },
      storage: await getStorageStatus(env),
      performance: await getPerformanceMetrics(env),
      security: await getSecurityStatus(env),
    };

    return createSuccessResponse(status);
  } catch (error) {
    console.error('Detailed status error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to get system status', 500);
  }
}

/**
 * 执行数据库迁移
 */
export async function runDatabaseMigration(
  _request: Request,
  env: Env,
  _ctx: any,
  context: Context
): Promise<Response> {
  try {
    if (!context.user || !hasPermission(context.user.role, 'admin')) {
      throw new ApiError('Insufficient permissions', 403);
    }

    const migration = new DatabaseMigration(env);
    const result = await migration.migrate();

    if (result.success) {
      return createSuccessResponse({
        message: 'Migration completed successfully',
        currentVersion: result.currentVersion,
      });
    } else {
      return createErrorResponse(result.error || 'Migration failed', 500);
    }
  } catch (error) {
    console.error('Migration error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to run migration', 500);
  }
}

/**
 * 创建数据库备份
 */
export async function createDatabaseBackup(
  _request: Request,
  env: Env,
  _ctx: any,
  context: Context
): Promise<Response> {
  try {
    if (!context.user || !hasPermission(context.user.role, 'admin')) {
      throw new ApiError('Insufficient permissions', 403);
    }

    const backup = new DatabaseBackup(env);
    const result = await backup.createBackup();

    if (result.success) {
      return createSuccessResponse({
        message: 'Backup created successfully',
        backupId: result.backupId,
      });
    } else {
      return createErrorResponse(result.error || 'Backup failed', 500);
    }
  } catch (error) {
    console.error('Backup error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to create backup', 500);
  }
}

/**
 * 恢复数据库备份
 */
export async function restoreDatabaseBackup(
  request: Request,
  env: Env,
  _ctx: any,
  context: Context
): Promise<Response> {
  try {
    if (!context.user || !hasPermission(context.user.role, 'admin')) {
      throw new ApiError('Insufficient permissions', 403);
    }

    const { backupId } = await request.json() as { backupId: string };
    if (!backupId) {
      throw new ApiError('Backup ID is required', 400);
    }

    const backup = new DatabaseBackup(env);
    const result = await backup.restoreBackup(backupId);

    if (result.success) {
      return createSuccessResponse({
        message: 'Backup restored successfully',
        backupId,
      });
    } else {
      return createErrorResponse(result.error || 'Restore failed', 500);
    }
  } catch (error) {
    console.error('Restore error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to restore backup', 500);
  }
}

/**
 * 获取存储状态
 */
async function getStorageStatus(env: Env): Promise<any> {
  try {
    if (!env.R2_BUCKET) {
      return { status: 'not_configured' };
    }

    // 获取存储桶信息
    const objects = await env.R2_BUCKET.list({ limit: 1 });
    
    return {
      status: 'healthy',
      configured: true,
      objectCount: objects.objects.length,
      truncated: objects.truncated,
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 获取性能指标
 */
async function getPerformanceMetrics(env: Env): Promise<any> {
  try {
    const startTime = Date.now();
    
    // 测试数据库查询性能
    await env.DB.prepare('SELECT 1').first();
    const dbLatency = Date.now() - startTime;

    return {
      dbLatency,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 获取安全状态
 */
async function getSecurityStatus(env: Env): Promise<any> {
  return {
    jwtConfigured: !!env.JWT_SECRET,
    githubOAuthConfigured: !!(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
    corsConfigured: !!env.CORS_ORIGINS,
    rateLimitConfigured: !!env.RATE_LIMIT_REQUESTS_PER_MINUTE,
  };
}
