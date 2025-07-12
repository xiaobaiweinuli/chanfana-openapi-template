import { Env, Context } from './types';
import { handleOptions, createErrorResponse } from './utils';
import { authMiddleware, loggingMiddleware, corsMiddleware, rateLimitMiddleware } from './middleware/auth';

// 导入路由处理器
import {
  handleGitHubCallback,
  getGitHubAuthUrl,
  verifyToken,
  refreshToken,
  logout,
  getCurrentUser,
  updateUser,
} from './routes/auth';

import {
  uploadFile,
  getFiles,
  getFile,
  deleteFile,
  getStorageUsage,
} from './routes/files';

import {
  generateSummary,
  generateTags,
  analyzeContent,
  translateText,
} from './routes/ai';

import {
  searchArticles,
  advancedSearch,
} from './routes/search';

import {
  getArticles,
  getArticleBySlug,
  createArticle,
  updateArticle,
  deleteArticle,
} from './routes/articles';

import {
  getUsers,
  getUserById,
  updateUserRole,
  toggleUserStatus,
  getUserStats,
  deleteUser,
} from './routes/users';

import {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  getCategoryBySlug,
} from './routes/categories';

import {
  getTags,
  createTag,
  updateTag,
  deleteTag,
  getTagBySlug,
  updateTagsOrder,
} from './routes/tags';

import {
  getPages,
  getPageBySlug,
  createPage,
  updatePage,
  deletePage,
} from './routes/pages';

import {
  getFriendLinks,
  createFriendLink,
  updateFriendLink,
  deleteFriendLink,
  updateFriendLinksStatus,
} from './routes/friend-links';

import {
  generateRSSFeed,
  generateAtomFeed,
  generateJSONFeed,
} from './routes/rss';

import {
  recordArticleView,
  getArticleStats,
  getDashboardStats,
  getPopularTags,
} from './routes/analytics';

import {
  generateSitemapIndex,
  generatePagesSitemap,
  generateArticlesSitemap,
  generateCategoriesSitemap,
  generateTagsSitemap,
  generateMultilingualSitemapIndex,
  generateLanguageSitemap,
} from './routes/sitemap';

import {
  getSystemHealth,
  getDetailedSystemStatus,
  runDatabaseMigration,
  createDatabaseBackup,
  restoreDatabaseBackup,
} from './routes/health';

import {
  getPerformanceMetrics,
  getHealthStatus,
  getSystemLogs,
  getRealTimeMetrics,
  getAlertHistory,
  getSystemStats,
  cleanupMetrics,
  exportMetrics,
} from './routes/monitoring';

import {
  getSession,
  getCsrfToken,
  getProviders,
  signInGitHub,
  callbackGitHub,
  signOut,
  validateSessionFromCookie,
} from './routes/nextauth-compat';

/**
 * 主要的 Worker 处理函数
 */
export default {
  async fetch(request: Request, env: Env, ctx: any): Promise<Response> {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      const method = request.method;

      // 设置 CORS
      const corsHeaders = corsMiddleware([env.FRONTEND_URL, 'http://localhost:3000']);
      
      // 处理 OPTIONS 请求
      if (method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders(request) });
      }

      // 初始化上下文
      let context: Context = {
        env,
        requestId: crypto.randomUUID(),
      };

      // 应用中间件
      context = await loggingMiddleware(request, env, ctx, context);
      context = await authMiddleware(request, env, ctx, context);

      // 路由处理
      let response: Response | undefined;

      // NextAuth 兼容路由
      if (path === '/api/auth/session' && method === 'GET') {
        response = await getSession(request, env, ctx, context);
      } else if (path === '/api/auth/csrf' && method === 'GET') {
        response = await getCsrfToken(request, env, ctx);
      } else if (path === '/api/auth/providers' && method === 'GET') {
        response = await getProviders(request, env, ctx);
      } else if (path === '/api/auth/signin/github' && method === 'GET') {
        response = await signInGitHub(request, env, ctx);
      } else if (path === '/api/auth/callback/github' && method === 'GET') {
        response = await callbackGitHub(request, env, ctx);
      } else if (path === '/api/auth/signout' && (method === 'GET' || method === 'POST')) {
        response = await signOut(request, env, ctx);
      }

      // 原有认证相关路由 (保持向后兼容)
      else if (path === '/api/auth/github/callback' && method === 'POST') {
        response = await handleGitHubCallback(request, env, ctx);
      } else if (path === '/api/auth/github/url' && method === 'GET') {
        response = await getGitHubAuthUrl(request, env, ctx);
      } else if (path === '/api/auth/verify' && method === 'POST') {
        response = await verifyToken(request, env, ctx);
      } else if (path === '/api/auth/refresh' && method === 'POST') {
        response = await refreshToken(request, env, ctx);
      } else if (path === '/api/auth/logout' && method === 'POST') {
        response = await logout(request, env, ctx, context);
      } else if (path === '/api/auth/me' && method === 'GET') {
        response = await getCurrentUser(request, env, ctx, context);
      } else if (path === '/api/auth/me' && method === 'PUT') {
        response = await updateUser(request, env, ctx, context);
      }
      
      // 文件相关路由
      else if (path === '/api/files/upload' && method === 'POST') {
        // 应用速率限制
        await rateLimitMiddleware(request, env, ctx, context, {
          windowMs: 60 * 1000, // 1 分钟
          maxRequests: 10, // 最多 10 次上传
        });
        response = await uploadFile(request, env, ctx, context);
      } else if (path === '/api/files' && method === 'GET') {
        response = await getFiles(request, env, ctx, context);
      } else if (path.startsWith('/api/files/') && method === 'GET') {
        const key = path.replace('/api/files/', '');
        response = await getFile(request, env, ctx, key);
      } else if (path.startsWith('/api/files/') && method === 'DELETE') {
        const fileId = path.replace('/api/files/', '');
        response = await deleteFile(request, env, ctx, context, fileId);
      } else if (path === '/api/files/usage' && method === 'GET') {
        response = await getStorageUsage(request, env, ctx, context);
      }
      
      // AI 相关路由
      else if (path === '/api/ai/summary' && method === 'POST') {
        // 应用速率限制
        await rateLimitMiddleware(request, env, ctx, context, {
          windowMs: 60 * 1000, // 1 分钟
          maxRequests: 20, // 最多 20 次 AI 请求
        });
        response = await generateSummary(request, env, ctx, context);
      } else if (path === '/api/ai/tags' && method === 'POST') {
        await rateLimitMiddleware(request, env, ctx, context, {
          windowMs: 60 * 1000,
          maxRequests: 20,
        });
        response = await generateTags(request, env, ctx, context);
      } else if (path === '/api/ai/analyze' && method === 'POST') {
        await rateLimitMiddleware(request, env, ctx, context, {
          windowMs: 60 * 1000,
          maxRequests: 10,
        });
        response = await analyzeContent(request, env, ctx, context);
      } else if (path === '/api/ai/translate' && method === 'POST') {
        await rateLimitMiddleware(request, env, ctx, context, {
          windowMs: 60 * 1000,
          maxRequests: 30,
        });
        response = await translateText(request, env, ctx, context);
      }
      
      // 搜索相关路由
      else if (path === '/api/search' && method === 'GET') {
        response = await searchArticles(request, env, ctx, context);
      } else if (path === '/api/search' && method === 'POST') {
        response = await advancedSearch(request, env, ctx, context);
      }

      // 文章相关路由
      else if (path === '/api/articles' && method === 'GET') {
        response = await getArticles(request, env, ctx, context);
      } else if (path === '/api/articles' && method === 'POST') {
        response = await createArticle(request, env, ctx, context);
      } else if (path.startsWith('/api/articles/') && method === 'GET') {
        const slug = path.replace('/api/articles/', '');
        response = await getArticleBySlug(request, env, ctx, context, slug);
      } else if (path.startsWith('/api/articles/') && method === 'PUT') {
        const articleId = path.replace('/api/articles/', '');
        response = await updateArticle(request, env, ctx, context, articleId);
      } else if (path.startsWith('/api/articles/') && method === 'DELETE') {
        const articleId = path.replace('/api/articles/', '');
        response = await deleteArticle(request, env, ctx, context, articleId);
      }

      // 用户管理路由
      else if (path === '/api/users' && method === 'GET') {
        response = await getUsers(request, env, ctx, context);
      } else if (path === '/api/users/stats' && method === 'GET') {
        response = await getUserStats(request, env, ctx, context);
      } else if (path.startsWith('/api/users/') && method === 'GET') {
        const userId = path.replace('/api/users/', '');
        if (userId !== 'stats') {
          response = await getUserById(request, env, ctx, context, userId);
        }
      } else if (path.startsWith('/api/users/') && path.endsWith('/role') && method === 'PUT') {
        const userId = path.replace('/api/users/', '').replace('/role', '');
        response = await updateUserRole(request, env, ctx, context, userId);
      } else if (path.startsWith('/api/users/') && path.endsWith('/status') && method === 'PUT') {
        const userId = path.replace('/api/users/', '').replace('/status', '');
        response = await toggleUserStatus(request, env, ctx, context, userId);
      } else if (path.startsWith('/api/users/') && method === 'DELETE') {
        const userId = path.replace('/api/users/', '');
        response = await deleteUser(request, env, ctx, context, userId);
      }

      // 分类管理路由
      else if (path === '/api/categories' && method === 'GET') {
        response = await getCategories(request, env, ctx, context);
      } else if (path === '/api/categories' && method === 'POST') {
        response = await createCategory(request, env, ctx, context);
      } else if (path.startsWith('/api/categories/') && method === 'GET') {
        const slug = path.replace('/api/categories/', '');
        response = await getCategoryBySlug(request, env, ctx, context, slug);
      } else if (path.startsWith('/api/categories/') && method === 'PUT') {
        const categoryId = path.replace('/api/categories/', '');
        response = await updateCategory(request, env, ctx, context, categoryId);
      } else if (path.startsWith('/api/categories/') && method === 'DELETE') {
        const categoryId = path.replace('/api/categories/', '');
        response = await deleteCategory(request, env, ctx, context, categoryId);
      }

      // 标签管理路由
      else if (path === '/api/tags' && method === 'GET') {
        response = await getTags(request, env, ctx, context);
      } else if (path === '/api/tags' && method === 'POST') {
        response = await createTag(request, env, ctx, context);
      } else if (path === '/api/tags/order' && method === 'PUT') {
        response = await updateTagsOrder(request, env, ctx, context);
      } else if (path.startsWith('/api/tags/') && method === 'GET') {
        const slug = path.replace('/api/tags/', '');
        response = await getTagBySlug(request, env, ctx, context, slug);
      } else if (path.startsWith('/api/tags/') && method === 'PUT') {
        const tagId = path.replace('/api/tags/', '');
        response = await updateTag(request, env, ctx, context, tagId);
      } else if (path.startsWith('/api/tags/') && method === 'DELETE') {
        const tagId = path.replace('/api/tags/', '');
        response = await deleteTag(request, env, ctx, context, tagId);
      }

      // 页面管理路由
      else if (path === '/api/pages' && method === 'GET') {
        response = await getPages(request, env, ctx, context);
      } else if (path === '/api/pages' && method === 'POST') {
        response = await createPage(request, env, ctx, context);
      } else if (path.startsWith('/api/pages/') && method === 'GET') {
        const slug = path.replace('/api/pages/', '');
        response = await getPageBySlug(request, env, ctx, context, slug);
      } else if (path.startsWith('/api/pages/') && method === 'PUT') {
        const pageId = path.replace('/api/pages/', '');
        response = await updatePage(request, env, ctx, context, pageId);
      } else if (path.startsWith('/api/pages/') && method === 'DELETE') {
        const pageId = path.replace('/api/pages/', '');
        response = await deletePage(request, env, ctx, context, pageId);
      }

      // 友情链接管理路由
      else if (path === '/api/friend-links' && method === 'GET') {
        response = await getFriendLinks(request, env, ctx, context);
      } else if (path === '/api/friend-links' && method === 'POST') {
        response = await createFriendLink(request, env, ctx, context);
      } else if (path === '/api/friend-links/batch-status' && method === 'PUT') {
        response = await updateFriendLinksStatus(request, env, ctx, context);
      } else if (path.startsWith('/api/friend-links/') && method === 'PUT') {
        const linkId = path.replace('/api/friend-links/', '');
        response = await updateFriendLink(request, env, ctx, context, linkId);
      } else if (path.startsWith('/api/friend-links/') && method === 'DELETE') {
        const linkId = path.replace('/api/friend-links/', '');
        response = await deleteFriendLink(request, env, ctx, context, linkId);
      }

      // RSS Feed 路由
      else if (path === '/api/feed.xml' && method === 'GET') {
        response = await generateRSSFeed(request, env, ctx, context);
      } else if (path === '/api/feed.atom' && method === 'GET') {
        response = await generateAtomFeed(request, env, ctx, context);
      } else if (path === '/api/feed.json' && method === 'GET') {
        response = await generateJSONFeed(request, env, ctx, context);
      } else if (path === '/feed.xml' && method === 'GET') {
        response = await generateRSSFeed(request, env, ctx, context);
      } else if (path === '/feed.atom' && method === 'GET') {
        response = await generateAtomFeed(request, env, ctx, context);
      } else if (path === '/feed.json' && method === 'GET') {
        response = await generateJSONFeed(request, env, ctx, context);
      }

      // 分析统计路由
      else if (path === '/api/analytics/view' && method === 'POST') {
        response = await recordArticleView(request, env, ctx, context);
      } else if (path === '/api/analytics/articles' && method === 'GET') {
        response = await getArticleStats(request, env, ctx, context);
      } else if (path === '/api/analytics/dashboard' && method === 'GET') {
        response = await getDashboardStats(request, env, ctx, context);
      } else if (path === '/api/analytics/tags' && method === 'GET') {
        response = await getPopularTags(request, env, ctx, context);
      }

      // 站点地图路由
      else if (path === '/sitemap.xml' && method === 'GET') {
        response = await generateSitemapIndex(request, env, ctx, context);
      } else if (path === '/sitemap-pages.xml' && method === 'GET') {
        response = await generatePagesSitemap(request, env, ctx, context);
      } else if (path === '/sitemap-articles.xml' && method === 'GET') {
        response = await generateArticlesSitemap(request, env, ctx, context);
      } else if (path === '/sitemap-categories.xml' && method === 'GET') {
        response = await generateCategoriesSitemap(request, env, ctx, context);
      } else if (path === '/sitemap-tags.xml' && method === 'GET') {
        response = await generateTagsSitemap(request, env, ctx, context);
      } else if (path === '/sitemap-multilingual.xml' && method === 'GET') {
        response = await generateMultilingualSitemapIndex(request, env, ctx, context);
      } else if (path.match(/^\/sitemap-(zh|en|ja)\.xml$/) && method === 'GET') {
        const language = path.match(/^\/sitemap-(zh|en|ja)\.xml$/)?.[1] || 'zh';
        response = await generateLanguageSitemap(request, env, ctx, context, language);
      }

      // 健康检查路由
      else if (path === '/health' && method === 'GET') {
        response = await getSystemHealth(request, env, ctx, context);
      } else if (path === '/api/system/status' && method === 'GET') {
        response = await getDetailedSystemStatus(request, env, ctx, context);
      } else if (path === '/api/system/migrate' && method === 'POST') {
        response = await runDatabaseMigration(request, env, ctx, context);
      } else if (path === '/api/system/backup' && method === 'POST') {
        response = await createDatabaseBackup(request, env, ctx, context);
      } else if (path === '/api/system/restore' && method === 'POST') {
        response = await restoreDatabaseBackup(request, env, ctx, context);
      }

      // 监控路由
      else if (path === '/api/monitoring/metrics' && method === 'GET') {
        response = await getPerformanceMetrics(request, env, ctx, context);
      } else if (path === '/api/monitoring/health' && method === 'GET') {
        response = await getHealthStatus(request, env, ctx, context);
      } else if (path === '/api/monitoring/logs' && method === 'GET') {
        response = await getSystemLogs(request, env, ctx, context);
      } else if (path === '/api/monitoring/realtime' && method === 'GET') {
        response = await getRealTimeMetrics(request, env, ctx, context);
      } else if (path === '/api/monitoring/alerts' && method === 'GET') {
        response = await getAlertHistory(request, env, ctx, context);
      } else if (path === '/api/monitoring/stats' && method === 'GET') {
        response = await getSystemStats(request, env, ctx, context);
      } else if (path === '/api/monitoring/cleanup' && method === 'POST') {
        response = await cleanupMetrics(request, env, ctx, context);
      } else if (path === '/api/monitoring/export' && method === 'GET') {
        response = await exportMetrics(request, env, ctx, context);
      }

      // 健康检查
      else if (path === '/api/health' && method === 'GET') {
        response = new Response(JSON.stringify({
          success: true,
          message: 'API is healthy',
          timestamp: new Date().toISOString(),
          environment: env.ENVIRONMENT,
        }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // 404 处理
      else {
        response = createErrorResponse('Not Found', 404);
      }

      // 确保 response 已定义
      if (!response) {
        response = createErrorResponse('Internal Server Error', 500);
      }

      // 添加 CORS 头
      const responseHeaders = new Headers(response.headers);
      corsHeaders(request).forEach((value, key) => {
        responseHeaders.set(key, value);
      });

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });

    } catch (error) {
      console.error('Worker error:', error);
      
      // 创建错误响应
      const errorResponse = createErrorResponse(
        error instanceof Error ? error.message : 'Internal Server Error',
        500
      );
      
      // 添加 CORS 头
      const responseHeaders = new Headers(errorResponse.headers);
      corsMiddleware([env.FRONTEND_URL, 'http://localhost:3000'])(request).forEach((value, key) => {
        responseHeaders.set(key, value);
      });

      return new Response(errorResponse.body, {
        status: errorResponse.status,
        statusText: errorResponse.statusText,
        headers: responseHeaders,
      });
    }
  },

  /**
   * 定时任务处理
   */
  async scheduled(event: any, env: Env, ctx: any): Promise<void> {
    console.log('Scheduled event triggered:', event.cron);
    
    try {
      // 清理过期的会话
      await cleanupExpiredSessions(env);
      
      // 清理临时文件
      await cleanupTempFiles(env);
      
      console.log('Scheduled cleanup completed');
    } catch (error) {
      console.error('Scheduled task error:', error);
    }
  },
};

/**
 * 清理过期的会话
 */
async function cleanupExpiredSessions(env: Env): Promise<void> {
  try {
    // 这里可以实现清理逻辑
    // KV 会自动处理过期，但可以添加额外的清理逻辑
    console.log('Session cleanup completed');
  } catch (error) {
    console.error('Session cleanup error:', error);
  }
}

/**
 * 清理临时文件
 */
async function cleanupTempFiles(env: Env): Promise<void> {
  try {
    // 清理超过 7 天的临时文件
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    const tempFiles = await env.DB.prepare(`
      SELECT r2_key FROM files 
      WHERE folder = 'temp' AND uploaded_at < ?
    `).bind(sevenDaysAgo.toISOString()).all();
    
    for (const file of tempFiles.results) {
      try {
        await env.STORAGE.delete(file.r2_key as string);
        await env.DB.prepare('DELETE FROM files WHERE r2_key = ?').bind(file.r2_key).run();
      } catch (error) {
        console.error('Failed to delete temp file:', file.r2_key, error);
      }
    }
    
    console.log(`Cleaned up ${tempFiles.results.length} temp files`);
  } catch (error) {
    console.error('Temp file cleanup error:', error);
  }
}
