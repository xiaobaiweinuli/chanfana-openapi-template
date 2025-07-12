import { Env } from '../types';

/**
 * 数据库连接状态检查
 */
export async function checkDatabaseConnection(env: Env): Promise<boolean> {
  try {
    const result = await env.DB.prepare('SELECT 1 as test').first();
    return result?.test === 1;
  } catch (error) {
    console.error('Database connection check failed:', error);
    return false;
  }
}

/**
 * 数据库健康检查
 */
export async function getDatabaseHealth(env: Env): Promise<{
  connected: boolean;
  tablesCount: number;
  lastBackup?: string;
  error?: string;
}> {
  try {
    // 检查连接
    const connected = await checkDatabaseConnection(env);
    if (!connected) {
      return { connected: false, tablesCount: 0, error: 'Connection failed' };
    }

    // 检查表数量
    const tablesResult = await env.DB.prepare(`
      SELECT COUNT(*) as count 
      FROM sqlite_master 
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
    `).first();
    
    const tablesCount = Number(tablesResult?.count || 0);

    // 检查最后备份时间（如果有备份表）
    let lastBackup: string | undefined;
    try {
      const backupResult = await env.DB.prepare(`
        SELECT value FROM settings WHERE key = 'last_backup_time'
      `).first();
      lastBackup = backupResult?.value as string;
    } catch {
      // 备份表可能不存在，忽略错误
    }

    return {
      connected: true,
      tablesCount,
      lastBackup,
    };
  } catch (error) {
    console.error('Database health check failed:', error);
    return {
      connected: false,
      tablesCount: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 数据库迁移管理
 */
export class DatabaseMigration {
  private env: Env;

  constructor(env: Env) {
    this.env = env;
  }

  /**
   * 获取当前数据库版本
   */
  async getCurrentVersion(): Promise<number> {
    try {
      const result = await this.env.DB.prepare(`
        SELECT value FROM settings WHERE key = 'db_version'
      `).first();
      return Number(result?.value || 0);
    } catch {
      return 0;
    }
  }

  /**
   * 设置数据库版本
   */
  async setVersion(version: number): Promise<void> {
    await this.env.DB.prepare(`
      INSERT OR REPLACE INTO settings (key, value, updated_at)
      VALUES ('db_version', ?, datetime('now'))
    `).bind(version.toString()).run();
  }

  /**
   * 执行迁移
   */
  async migrate(): Promise<{ success: boolean; currentVersion: number; error?: string }> {
    try {
      const currentVersion = await this.getCurrentVersion();
      const targetVersion = this.getLatestVersion();

      if (currentVersion >= targetVersion) {
        return { success: true, currentVersion };
      }

      // 执行迁移
      for (let version = currentVersion + 1; version <= targetVersion; version++) {
        await this.runMigration(version);
        await this.setVersion(version);
      }

      return { success: true, currentVersion: targetVersion };
    } catch (error) {
      console.error('Migration failed:', error);
      return {
        success: false,
        currentVersion: await this.getCurrentVersion(),
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * 获取最新版本号
   */
  private getLatestVersion(): number {
    return 3; // 当前最新版本
  }

  /**
   * 执行特定版本的迁移
   */
  private async runMigration(version: number): Promise<void> {
    switch (version) {
      case 1:
        await this.migration_v1();
        break;
      case 2:
        await this.migration_v2();
        break;
      case 3:
        await this.migration_v3();
        break;
      default:
        throw new Error(`Unknown migration version: ${version}`);
    }
  }

  /**
   * 迁移 v1: 添加浏览量字段
   */
  private async migration_v1(): Promise<void> {
    await this.env.DB.prepare(`
      ALTER TABLE articles ADD COLUMN view_count INTEGER DEFAULT 0
    `).run();
  }

  /**
   * 迁移 v2: 添加统计表
   */
  private async migration_v2(): Promise<void> {
    await this.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS article_views (
        id TEXT PRIMARY KEY,
        article_id TEXT NOT NULL,
        visitor_id TEXT,
        ip_address TEXT,
        user_agent TEXT,
        referer TEXT,
        country TEXT,
        city TEXT,
        viewed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
      )
    `).run();

    await this.env.DB.prepare(`
      CREATE INDEX IF NOT EXISTS idx_article_views_article_id ON article_views(article_id)
    `).run();
  }

  /**
   * 迁移 v3: 添加网站分析表
   */
  private async migration_v3(): Promise<void> {
    await this.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS site_analytics (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        page_path TEXT NOT NULL,
        page_title TEXT,
        visitor_count INTEGER DEFAULT 0,
        page_views INTEGER DEFAULT 0,
        unique_visitors INTEGER DEFAULT 0,
        bounce_rate REAL DEFAULT 0,
        avg_session_duration INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(date, page_path)
      )
    `).run();

    await this.env.DB.prepare(`
      CREATE INDEX IF NOT EXISTS idx_site_analytics_date ON site_analytics(date)
    `).run();
  }
}

/**
 * 数据库备份管理
 */
export class DatabaseBackup {
  private env: Env;

  constructor(env: Env) {
    this.env = env;
  }

  /**
   * 创建数据库备份
   */
  async createBackup(): Promise<{ success: boolean; backupId?: string; error?: string }> {
    try {
      const backupId = `backup_${Date.now()}`;
      const timestamp = new Date().toISOString();

      // 获取所有表的数据
      const tables = await this.getAllTables();
      const backupData: Record<string, any[]> = {};

      for (const table of tables) {
        const data = await this.env.DB.prepare(`SELECT * FROM ${table}`).all();
        backupData[table] = data.results;
      }

      // 将备份数据存储到 R2（如果配置了）或本地设置表
      const backupJson = JSON.stringify({
        id: backupId,
        timestamp,
        version: await new DatabaseMigration(this.env).getCurrentVersion(),
        data: backupData,
      });

      // 存储备份信息到设置表
      await this.env.DB.prepare(`
        INSERT OR REPLACE INTO settings (key, value, updated_at)
        VALUES ('last_backup_time', ?, datetime('now'))
      `).bind(timestamp).run();

      await this.env.DB.prepare(`
        INSERT OR REPLACE INTO settings (key, value, updated_at)
        VALUES ('last_backup_id', ?, datetime('now'))
      `).bind(backupId).run();

      // 如果配置了 R2，上传备份文件
      if (this.env.R2_BUCKET) {
        try {
          await this.env.R2_BUCKET.put(`backups/${backupId}.json`, backupJson);
        } catch (error) {
          console.warn('Failed to upload backup to R2:', error);
        }
      }

      return { success: true, backupId };
    } catch (error) {
      console.error('Backup creation failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * 恢复数据库备份
   */
  async restoreBackup(backupId: string): Promise<{ success: boolean; error?: string }> {
    try {
      // 从 R2 获取备份数据
      if (!this.env.R2_BUCKET) {
        throw new Error('R2 bucket not configured');
      }

      const backupObject = await this.env.R2_BUCKET.get(`backups/${backupId}.json`);
      if (!backupObject) {
        throw new Error('Backup not found');
      }

      const backupJson = await backupObject.text();
      const backup = JSON.parse(backupJson);

      // 清空现有数据（谨慎操作）
      const tables = await this.getAllTables();
      for (const table of tables) {
        if (table !== 'settings') { // 保留设置表
          await this.env.DB.prepare(`DELETE FROM ${table}`).run();
        }
      }

      // 恢复数据
      for (const [tableName, tableData] of Object.entries(backup.data)) {
        if (Array.isArray(tableData) && tableData.length > 0) {
          const columns = Object.keys(tableData[0]);
          const placeholders = columns.map(() => '?').join(', ');
          const insertSql = `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`;

          for (const row of tableData) {
            const values = columns.map(col => row[col]);
            await this.env.DB.prepare(insertSql).bind(...values).run();
          }
        }
      }

      // 更新恢复信息
      await this.env.DB.prepare(`
        INSERT OR REPLACE INTO settings (key, value, updated_at)
        VALUES ('last_restore_time', ?, datetime('now'))
      `).bind(new Date().toISOString()).run();

      await this.env.DB.prepare(`
        INSERT OR REPLACE INTO settings (key, value, updated_at)
        VALUES ('last_restore_backup_id', ?, datetime('now'))
      `).bind(backupId).run();

      return { success: true };
    } catch (error) {
      console.error('Backup restoration failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * 获取所有表名
   */
  private async getAllTables(): Promise<string[]> {
    const result = await this.env.DB.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
    `).all();

    return result.results.map((row: any) => row.name);
  }

  /**
   * 清理旧备份
   */
  async cleanupOldBackups(retentionDays: number = 30): Promise<void> {
    if (!this.env.R2_BUCKET) return;

    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      const objects = await this.env.R2_BUCKET.list({ prefix: 'backups/' });
      
      for (const object of objects.objects) {
        if (object.uploaded && object.uploaded < cutoffDate) {
          await this.env.R2_BUCKET.delete(object.key);
        }
      }
    } catch (error) {
      console.error('Failed to cleanup old backups:', error);
    }
  }
}

/**
 * 数据库工具函数
 */
export const DatabaseUtils = {
  /**
   * 重试执行数据库操作
   */
  async withRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    delay: number = 1000
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');
        
        if (attempt === maxRetries) {
          throw lastError;
        }

        // 等待后重试
        await new Promise(resolve => setTimeout(resolve, delay * attempt));
      }
    }

    throw lastError!;
  },

  /**
   * 事务执行
   */
  async transaction<T>(
    env: Env,
    operations: (db: any) => Promise<T>
  ): Promise<T> {
    // D1 目前不支持显式事务，但可以使用批处理
    return await operations(env.DB);
  },

  /**
   * 批量插入
   */
  async batchInsert(
    env: Env,
    tableName: string,
    records: Record<string, any>[],
    batchSize: number = 100
  ): Promise<void> {
    if (records.length === 0) return;

    const columns = Object.keys(records[0]);
    const placeholders = columns.map(() => '?').join(', ');
    const sql = `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`;

    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      const statements = batch.map(record => {
        const values = columns.map(col => record[col]);
        return env.DB.prepare(sql).bind(...values);
      });

      await env.DB.batch(statements);
    }
  },
};
