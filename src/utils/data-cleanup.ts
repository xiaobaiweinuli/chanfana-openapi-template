import { Env } from '../types';
import { getLogger } from './logger';
import { getDatabaseOptimizer } from './database-optimizer';

/**
 * 数据清理配置
 */
interface CleanupConfig {
  // 文章浏览记录保留天数
  articleViewsRetentionDays: number;
  // 网站分析数据保留天数
  analyticsRetentionDays: number;
  // 日志保留天数
  logsRetentionDays: number;
  // 会话数据保留天数
  sessionRetentionDays: number;
  // 临时文件保留天数
  tempFilesRetentionDays: number;
  // 是否启用自动清理
  autoCleanupEnabled: boolean;
  // 清理批次大小
  batchSize: number;
}

/**
 * 清理结果
 */
interface CleanupResult {
  table: string;
  deletedCount: number;
  duration: number;
  error?: string;
}

/**
 * 数据清理管理器
 */
export class DataCleanupManager {
  private env: Env;
  private logger: ReturnType<typeof getLogger>;
  private optimizer: ReturnType<typeof getDatabaseOptimizer>;
  private config: CleanupConfig;

  constructor(env: Env) {
    this.env = env;
    this.logger = getLogger(env);
    this.optimizer = getDatabaseOptimizer(env);
    this.config = {
      articleViewsRetentionDays: 90, // 3个月
      analyticsRetentionDays: 365, // 1年
      logsRetentionDays: 30, // 1个月
      sessionRetentionDays: 7, // 1周
      tempFilesRetentionDays: 1, // 1天
      autoCleanupEnabled: env.NODE_ENV === 'production',
      batchSize: 1000,
    };
  }

  /**
   * 执行完整的数据清理
   */
  async performFullCleanup(): Promise<CleanupResult[]> {
    await this.logger.info('Starting full data cleanup');
    const results: CleanupResult[] = [];

    try {
      // 清理文章浏览记录
      const viewsResult = await this.cleanupArticleViews();
      results.push(viewsResult);

      // 清理网站分析数据
      const analyticsResult = await this.cleanupAnalyticsData();
      results.push(analyticsResult);

      // 清理会话数据
      const sessionResult = await this.cleanupSessionData();
      results.push(sessionResult);

      // 清理临时文件
      const filesResult = await this.cleanupTempFiles();
      results.push(filesResult);

      // 清理孤立数据
      const orphanResults = await this.cleanupOrphanedData();
      results.push(...orphanResults);

      // 优化数据库
      await this.optimizeDatabase();

      const totalDeleted = results.reduce((sum, result) => sum + result.deletedCount, 0);
      await this.logger.info('Full data cleanup completed', {
        totalDeleted,
        results: results.length,
      });

      return results;
    } catch (error) {
      await this.logger.error('Full data cleanup failed', error as Error);
      throw error;
    }
  }

  /**
   * 清理文章浏览记录
   */
  async cleanupArticleViews(): Promise<CleanupResult> {
    const startTime = Date.now();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.articleViewsRetentionDays);

    try {
      const result = await this.optimizer.executeQuery(
        `DELETE FROM article_views WHERE viewed_at < ?`,
        [cutoffDate.toISOString()],
        { cache: false }
      );

      const deletedCount = result.meta?.changes || 0;
      const duration = Date.now() - startTime;

      await this.logger.info('Article views cleanup completed', {
        deletedCount,
        duration,
        cutoffDate: cutoffDate.toISOString(),
      });

      return {
        table: 'article_views',
        deletedCount,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      await this.logger.error('Article views cleanup failed', error as Error);
      
      return {
        table: 'article_views',
        deletedCount: 0,
        duration,
        error: (error as Error).message,
      };
    }
  }

  /**
   * 清理网站分析数据
   */
  async cleanupAnalyticsData(): Promise<CleanupResult> {
    const startTime = Date.now();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.analyticsRetentionDays);

    try {
      const result = await this.optimizer.executeQuery(
        `DELETE FROM site_analytics WHERE date < ?`,
        [cutoffDate.toISOString().split('T')[0]],
        { cache: false }
      );

      const deletedCount = result.meta?.changes || 0;
      const duration = Date.now() - startTime;

      await this.logger.info('Analytics data cleanup completed', {
        deletedCount,
        duration,
        cutoffDate: cutoffDate.toISOString(),
      });

      return {
        table: 'site_analytics',
        deletedCount,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      await this.logger.error('Analytics data cleanup failed', error as Error);
      
      return {
        table: 'site_analytics',
        deletedCount: 0,
        duration,
        error: (error as Error).message,
      };
    }
  }

  /**
   * 清理会话数据
   */
  async cleanupSessionData(): Promise<CleanupResult> {
    const startTime = Date.now();
    let deletedCount = 0;

    try {
      // 清理 KV 中的过期会话
      if (this.env.SESSION_KV) {
        // KV 会自动处理过期，但我们可以主动清理
        // 这里只是记录操作，实际清理由 KV 自动处理
        deletedCount = 0; // KV 自动清理，无法获取确切数量
      }

      const duration = Date.now() - startTime;

      await this.logger.info('Session data cleanup completed', {
        deletedCount,
        duration,
      });

      return {
        table: 'sessions',
        deletedCount,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      await this.logger.error('Session data cleanup failed', error as Error);
      
      return {
        table: 'sessions',
        deletedCount: 0,
        duration,
        error: (error as Error).message,
      };
    }
  }

  /**
   * 清理临时文件
   */
  async cleanupTempFiles(): Promise<CleanupResult> {
    const startTime = Date.now();
    let deletedCount = 0;

    try {
      if (this.env.R2_BUCKET) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - this.config.tempFilesRetentionDays);

        // 列出临时文件夹中的文件
        const objects = await this.env.R2_BUCKET.list({ prefix: 'temp/' });
        
        for (const object of objects.objects) {
          if (object.uploaded && object.uploaded < cutoffDate) {
            await this.env.R2_BUCKET.delete(object.key);
            deletedCount++;
          }
        }
      }

      const duration = Date.now() - startTime;

      await this.logger.info('Temp files cleanup completed', {
        deletedCount,
        duration,
      });

      return {
        table: 'temp_files',
        deletedCount,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      await this.logger.error('Temp files cleanup failed', error as Error);
      
      return {
        table: 'temp_files',
        deletedCount: 0,
        duration,
        error: (error as Error).message,
      };
    }
  }

  /**
   * 清理孤立数据
   */
  async cleanupOrphanedData(): Promise<CleanupResult[]> {
    const results: CleanupResult[] = [];

    // 清理孤立的文章浏览记录（文章已删除）
    const orphanViewsResult = await this.cleanupOrphanedViews();
    results.push(orphanViewsResult);

    // 清理孤立的文件记录（文件已删除）
    const orphanFilesResult = await this.cleanupOrphanedFiles();
    results.push(orphanFilesResult);

    return results;
  }

  /**
   * 清理孤立的浏览记录
   */
  private async cleanupOrphanedViews(): Promise<CleanupResult> {
    const startTime = Date.now();

    try {
      const result = await this.optimizer.executeQuery(
        `DELETE FROM article_views 
         WHERE article_id NOT IN (SELECT id FROM articles)`,
        [],
        { cache: false }
      );

      const deletedCount = result.meta?.changes || 0;
      const duration = Date.now() - startTime;

      await this.logger.info('Orphaned views cleanup completed', {
        deletedCount,
        duration,
      });

      return {
        table: 'orphaned_views',
        deletedCount,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      await this.logger.error('Orphaned views cleanup failed', error as Error);
      
      return {
        table: 'orphaned_views',
        deletedCount: 0,
        duration,
        error: (error as Error).message,
      };
    }
  }

  /**
   * 清理孤立的文件记录
   */
  private async cleanupOrphanedFiles(): Promise<CleanupResult> {
    const startTime = Date.now();
    let deletedCount = 0;

    try {
      // 获取数据库中的文件记录
      const dbFiles = await this.optimizer.executeQuery(
        `SELECT id, url FROM files`,
        [],
        { cache: false }
      );

      if (this.env.R2_BUCKET && dbFiles.results) {
        for (const file of dbFiles.results as any[]) {
          try {
            const key = this.extractKeyFromUrl(file.url);
            const object = await this.env.R2_BUCKET.head(key);
            
            if (!object) {
              // 文件不存在，删除数据库记录
              await this.optimizer.executeQuery(
                `DELETE FROM files WHERE id = ?`,
                [file.id],
                { cache: false }
              );
              deletedCount++;
            }
          } catch {
            // 文件不存在或访问失败，删除数据库记录
            await this.optimizer.executeQuery(
              `DELETE FROM files WHERE id = ?`,
              [file.id],
              { cache: false }
            );
            deletedCount++;
          }
        }
      }

      const duration = Date.now() - startTime;

      await this.logger.info('Orphaned files cleanup completed', {
        deletedCount,
        duration,
      });

      return {
        table: 'orphaned_files',
        deletedCount,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      await this.logger.error('Orphaned files cleanup failed', error as Error);
      
      return {
        table: 'orphaned_files',
        deletedCount: 0,
        duration,
        error: (error as Error).message,
      };
    }
  }

  /**
   * 从URL提取R2对象键
   */
  private extractKeyFromUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      return urlObj.pathname.substring(1); // 移除开头的 '/'
    } catch {
      return url;
    }
  }

  /**
   * 优化数据库
   */
  async optimizeDatabase(): Promise<void> {
    try {
      await this.logger.info('Starting database optimization');

      // 分析表统计信息
      await this.optimizer.executeQuery('ANALYZE', [], { cache: false });

      // 清理查询缓存
      this.optimizer.clearCache();

      await this.logger.info('Database optimization completed');
    } catch (error) {
      await this.logger.error('Database optimization failed', error as Error);
    }
  }

  /**
   * 获取数据库大小统计
   */
  async getDatabaseStats(): Promise<{
    tables: Array<{
      name: string;
      rowCount: number;
      estimatedSize: number;
    }>;
    totalRows: number;
  }> {
    const tables = [
      'users', 'articles', 'pages', 'categories', 'tags',
      'friend_links', 'files', 'article_views', 'site_analytics', 'settings'
    ];

    const tableStats = [];
    let totalRows = 0;

    for (const table of tables) {
      try {
        const result = await this.optimizer.executeQuery(
          `SELECT COUNT(*) as count FROM ${table}`,
          [],
          { cache: true, cacheTtl: 300 }
        );

        const rowCount = result.results?.[0]?.count || 0;
        totalRows += rowCount;

        tableStats.push({
          name: table,
          rowCount,
          estimatedSize: rowCount * 1024, // 粗略估算
        });
      } catch (error) {
        await this.logger.warn(`Failed to get stats for table ${table}`, { error });
      }
    }

    return {
      tables: tableStats,
      totalRows,
    };
  }

  /**
   * 设置清理配置
   */
  setConfig(config: Partial<CleanupConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取清理配置
   */
  getConfig(): CleanupConfig {
    return { ...this.config };
  }
}

/**
 * 全局数据清理管理器实例
 */
let globalCleanupManager: DataCleanupManager | null = null;

/**
 * 获取数据清理管理器实例
 */
export function getDataCleanupManager(env: Env): DataCleanupManager {
  if (!globalCleanupManager) {
    globalCleanupManager = new DataCleanupManager(env);
  }
  return globalCleanupManager;
}
