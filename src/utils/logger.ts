import { Env } from '../types';

/**
 * 日志级别
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  FATAL = 4,
}

/**
 * 日志级别映射
 */
const LOG_LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.ERROR]: 'ERROR',
  [LogLevel.FATAL]: 'FATAL',
};

/**
 * 日志条目接口
 */
interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, any>;
  error?: Error;
  requestId?: string;
  userId?: string;
  ip?: string;
  userAgent?: string;
  method?: string;
  url?: string;
  duration?: number;
  statusCode?: number;
}

/**
 * 日志配置
 */
interface LoggerConfig {
  level: LogLevel;
  enableConsole: boolean;
  enableAnalytics: boolean;
  enableRemote: boolean;
  remoteEndpoint?: string;
  maxBatchSize: number;
  flushInterval: number;
}

/**
 * 结构化日志记录器
 */
export class Logger {
  private config: LoggerConfig;
  private env: Env;
  private logBuffer: LogEntry[] = [];
  private lastFlush: number = Date.now();

  constructor(env: Env, config?: Partial<LoggerConfig>) {
    this.env = env;
    this.config = {
      level: this.parseLogLevel(env.LOG_LEVEL || 'info'),
      enableConsole: env.NODE_ENV !== 'production',
      enableAnalytics: env.ENABLE_ANALYTICS === 'true',
      enableRemote: env.ENABLE_MONITORING === 'true',
      remoteEndpoint: env.LOG_ENDPOINT,
      maxBatchSize: 100,
      flushInterval: 30000, // 30秒
      ...config,
    };
  }

  /**
   * 解析日志级别
   */
  private parseLogLevel(level: string): LogLevel {
    switch (level.toLowerCase()) {
      case 'debug': return LogLevel.DEBUG;
      case 'info': return LogLevel.INFO;
      case 'warn': return LogLevel.WARN;
      case 'error': return LogLevel.ERROR;
      case 'fatal': return LogLevel.FATAL;
      default: return LogLevel.INFO;
    }
  }

  /**
   * 检查是否应该记录此级别的日志
   */
  private shouldLog(level: LogLevel): boolean {
    return level >= this.config.level;
  }

  /**
   * 创建日志条目
   */
  private createLogEntry(
    level: LogLevel,
    message: string,
    context?: Record<string, any>,
    error?: Error
  ): LogEntry {
    return {
      timestamp: new Date().toISOString(),
      level,
      message,
      context,
      error,
      requestId: context?.requestId,
      userId: context?.userId,
      ip: context?.ip,
      userAgent: context?.userAgent,
      method: context?.method,
      url: context?.url,
      duration: context?.duration,
      statusCode: context?.statusCode,
    };
  }

  /**
   * 记录日志
   */
  public async log(
    level: LogLevel,
    message: string,
    context?: Record<string, any>,
    error?: Error
  ): Promise<void> {
    if (!this.shouldLog(level)) {
      return;
    }

    const entry = this.createLogEntry(level, message, context, error);

    // 控制台输出
    if (this.config.enableConsole) {
      this.logToConsole(entry);
    }

    // 添加到缓冲区
    this.logBuffer.push(entry);

    // 检查是否需要刷新
    if (
      this.logBuffer.length >= this.config.maxBatchSize ||
      Date.now() - this.lastFlush >= this.config.flushInterval ||
      level >= LogLevel.ERROR
    ) {
      await this.flush();
    }
  }

  /**
   * 输出到控制台
   */
  private logToConsole(entry: LogEntry): void {
    const levelName = LOG_LEVEL_NAMES[entry.level];
    const timestamp = entry.timestamp;
    const message = entry.message;
    
    let logMessage = `[${timestamp}] ${levelName}: ${message}`;
    
    if (entry.context) {
      logMessage += ` | Context: ${JSON.stringify(entry.context)}`;
    }

    switch (entry.level) {
      case LogLevel.DEBUG:
        console.debug(logMessage);
        break;
      case LogLevel.INFO:
        console.info(logMessage);
        break;
      case LogLevel.WARN:
        console.warn(logMessage);
        break;
      case LogLevel.ERROR:
      case LogLevel.FATAL:
        console.error(logMessage);
        if (entry.error) {
          console.error(entry.error);
        }
        break;
    }
  }

  /**
   * 刷新日志缓冲区
   */
  private async flush(): Promise<void> {
    if (this.logBuffer.length === 0) {
      return;
    }

    const logs = [...this.logBuffer];
    this.logBuffer = [];
    this.lastFlush = Date.now();

    // 发送到 Analytics Engine
    if (this.config.enableAnalytics && this.env.ANALYTICS) {
      try {
        for (const log of logs) {
          await this.env.ANALYTICS.writeDataPoint({
            blobs: [
              log.level.toString(),
              log.message,
              log.requestId || '',
              log.userId || '',
              log.ip || '',
              log.method || '',
              log.url || '',
            ],
            doubles: [
              log.duration || 0,
              log.statusCode || 0,
            ],
            indexes: [log.timestamp],
          });
        }
      } catch (error) {
        console.error('Failed to write logs to Analytics Engine:', error);
      }
    }

    // 发送到远程端点
    if (this.config.enableRemote && this.config.remoteEndpoint) {
      try {
        await fetch(this.config.remoteEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ logs }),
        });
      } catch (error) {
        console.error('Failed to send logs to remote endpoint:', error);
      }
    }
  }

  /**
   * Debug 级别日志
   */
  async debug(message: string, context?: Record<string, any>): Promise<void> {
    await this.log(LogLevel.DEBUG, message, context);
  }

  /**
   * Info 级别日志
   */
  async info(message: string, context?: Record<string, any>): Promise<void> {
    await this.log(LogLevel.INFO, message, context);
  }

  /**
   * Warning 级别日志
   */
  async warn(message: string, context?: Record<string, any>): Promise<void> {
    await this.log(LogLevel.WARN, message, context);
  }

  /**
   * Error 级别日志
   */
  async error(message: string, error?: Error, context?: Record<string, any>): Promise<void> {
    await this.log(LogLevel.ERROR, message, context, error);
  }

  /**
   * Fatal 级别日志
   */
  async fatal(message: string, error?: Error, context?: Record<string, any>): Promise<void> {
    await this.log(LogLevel.FATAL, message, context, error);
  }

  /**
   * 记录请求日志
   */
  async logRequest(
    request: Request,
    response: Response,
    duration: number,
    context?: Record<string, any>
  ): Promise<void> {
    const url = new URL(request.url);
    const requestContext = {
      method: request.method,
      url: url.pathname + url.search,
      statusCode: response.status,
      duration,
      ip: request.headers.get('CF-Connecting-IP') || 
          request.headers.get('X-Forwarded-For') || 
          request.headers.get('X-Real-IP'),
      userAgent: request.headers.get('User-Agent'),
      referer: request.headers.get('Referer'),
      ...context,
    };

    const level = response.status >= 500 ? LogLevel.ERROR :
                  response.status >= 400 ? LogLevel.WARN :
                  LogLevel.INFO;

    const message = `${request.method} ${url.pathname} ${response.status} ${duration}ms`;
    
    await this.log(level, message, requestContext);
  }

  /**
   * 记录性能指标
   */
  async logPerformance(
    operation: string,
    duration: number,
    context?: Record<string, any>
  ): Promise<void> {
    await this.info(`Performance: ${operation} took ${duration}ms`, {
      operation,
      duration,
      ...context,
    });
  }

  /**
   * 记录安全事件
   */
  async logSecurity(
    event: string,
    severity: 'low' | 'medium' | 'high' | 'critical',
    context?: Record<string, any>
  ): Promise<void> {
    const level = severity === 'critical' ? LogLevel.FATAL :
                  severity === 'high' ? LogLevel.ERROR :
                  severity === 'medium' ? LogLevel.WARN :
                  LogLevel.INFO;

    await this.log(level, `Security: ${event}`, {
      event,
      severity,
      ...context,
    });
  }

  /**
   * 记录业务事件
   */
  async logBusiness(
    event: string,
    data?: Record<string, any>
  ): Promise<void> {
    await this.info(`Business: ${event}`, {
      event,
      ...data,
    });
  }

  /**
   * 强制刷新日志
   */
  async forceFlush(): Promise<void> {
    await this.flush();
  }
}

/**
 * 创建请求日志中间件
 */
export function createRequestLogger(logger: Logger) {
  return async (
    request: Request,
    handler: () => Promise<Response>
  ): Promise<Response> => {
    const startTime = Date.now();
    const requestId = crypto.randomUUID();
    
    // 添加请求ID到请求对象
    (request as any).requestId = requestId;
    
    try {
      const response = await handler();
      const duration = Date.now() - startTime;
      
      await logger.logRequest(request, response, duration, { requestId });
      
      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      await logger.error('Request failed', error as Error, {
        requestId,
        method: request.method,
        url: request.url,
        duration,
      });
      
      throw error;
    }
  };
}

/**
 * 全局日志记录器实例
 */
let globalLogger: Logger | null = null;

/**
 * 获取日志记录器实例
 */
export function getLogger(env: Env): Logger {
  if (!globalLogger) {
    globalLogger = new Logger(env);
  }
  return globalLogger;
}

/**
 * 日志装饰器
 */
export function logMethod(
  level: LogLevel = LogLevel.INFO,
  includeArgs: boolean = false,
  includeResult: boolean = false
) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const logger = getLogger((this as any).env);
      const startTime = Date.now();
      
      try {
        const context: Record<string, any> = {
          method: `${target.constructor.name}.${propertyKey}`,
        };
        
        if (includeArgs) {
          context.args = args;
        }
        
        await logger.log(level, `Calling ${target.constructor.name}.${propertyKey}`, context);
        
        const result = await originalMethod.apply(this, args);
        const duration = Date.now() - startTime;
        
        const resultContext: Record<string, any> = {
          method: `${target.constructor.name}.${propertyKey}`,
          duration,
        };
        
        if (includeResult) {
          resultContext.result = result;
        }
        
        await logger.log(level, `Completed ${target.constructor.name}.${propertyKey}`, resultContext);
        
        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        
        await logger.error(`Failed ${target.constructor.name}.${propertyKey}`, error as Error, {
          method: `${target.constructor.name}.${propertyKey}`,
          duration,
          args: includeArgs ? args : undefined,
        });
        
        throw error;
      }
    };

    return descriptor;
  };
}
