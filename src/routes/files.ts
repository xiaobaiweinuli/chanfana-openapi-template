import { Env, Context, ApiError } from '../types';
import { StorageService } from '../services/storage';
import { DatabaseService } from '../services/database';
import { createSuccessResponse, createErrorResponse, safeJsonParse } from '../utils';
import { hasPermission } from '../utils/jwt';

/**
 * 上传文件
 */
export async function uploadFile(
  request: Request,
  env: Env,
  ctx: any,
  context: Context
): Promise<Response> {
  try {
    if (!context.user) {
      throw new ApiError('Authentication required', 401);
    }

    const formData = await request.formData();
    const file = formData.get('file') as File;
    const folder = formData.get('folder') as string || 'uploads';
    const isPublic = formData.get('isPublic') === 'true';

    if (!file) {
      throw new ApiError('File is required', 400);
    }

    // 获取系统设置
    const dbService = new DatabaseService(env.DB);
    const maxSizeResult = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind('max_file_size').first();
    const allowedTypesResult = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind('allowed_file_types').first();
    
    const maxSize = parseInt(maxSizeResult?.value as string || '10485760'); // 10MB
    const allowedTypes = safeJsonParse(allowedTypesResult?.value as string || '[]', []);

    // 初始化存储服务
    const storageService = new StorageService(env.STORAGE);
    
    // 上传文件到 R2
    const uploadResult = await storageService.uploadFile(file, file.name, {
      maxSize,
      allowedTypes,
      folder,
      isPublic,
    });

    // 保存文件记录到数据库
    const fileRecord = await dbService.createFile({
      name: uploadResult.name,
      original_name: file.name,
      size: uploadResult.size,
      type: uploadResult.type,
      url: uploadResult.url,
      r2_key: uploadResult.key,
      uploaded_by: context.user.id,
      is_public: isPublic,
      folder,
      metadata: {
        uploadedAt: new Date().toISOString(),
        userAgent: request.headers.get('User-Agent'),
      },
    });

    return createSuccessResponse(fileRecord);
  } catch (error) {
    console.error('File upload error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'File upload failed', 500);
  }
}

/**
 * 获取文件列表
 */
export async function getFiles(
  request: Request,
  env: Env,
  ctx: any,
  context: Context
): Promise<Response> {
  try {
    if (!context.user) {
      throw new ApiError('Authentication required', 401);
    }

    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = parseInt(url.searchParams.get('limit') || '20');
    const folder = url.searchParams.get('folder') || undefined;
    const offset = (page - 1) * limit;

    const dbService = new DatabaseService(env.DB);
    
    // 管理员可以查看所有文件，其他用户只能查看自己的文件
    const options = {
      limit,
      offset,
      folder,
      ...(hasPermission(context.user.role, 'admin') ? {} : { uploaded_by: context.user.id }),
    };

    const result = await dbService.getFiles(options);
    
    return createSuccessResponse(result);
  } catch (error) {
    console.error('Get files error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to get files', 500);
  }
}

/**
 * 获取文件内容
 */
export async function getFile(
  request: Request,
  env: Env,
  ctx: any,
  key: string
): Promise<Response> {
  try {
    const storageService = new StorageService(env.STORAGE);
    const object = await storageService.getFile(key);
    
    if (!object) {
      throw new ApiError('File not found', 404);
    }

    // 检查文件权限
    const dbService = new DatabaseService(env.DB);
    const fileRecord = await env.DB.prepare('SELECT * FROM files WHERE r2_key = ?').bind(key).first();
    
    if (!fileRecord) {
      throw new ApiError('File record not found', 404);
    }

    // 如果文件不是公开的，需要验证权限
    if (!fileRecord.is_public) {
      const authHeader = request.headers.get('Authorization');
      if (!authHeader) {
        throw new ApiError('Authentication required for private file', 401);
      }
      
      // 这里可以添加更详细的权限检查
    }

    const headers = new Headers();
    headers.set('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream');
    headers.set('Content-Length', object.size.toString());
    headers.set('Cache-Control', 'public, max-age=31536000'); // 1 年缓存
    
    if (object.httpMetadata?.contentDisposition) {
      headers.set('Content-Disposition', object.httpMetadata.contentDisposition);
    }

    return new Response(object.body, { headers });
  } catch (error) {
    console.error('Get file error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to get file', 500);
  }
}

/**
 * 删除文件
 */
export async function deleteFile(
  request: Request,
  env: Env,
  ctx: any,
  context: Context,
  fileId: string
): Promise<Response> {
  try {
    if (!context.user) {
      throw new ApiError('Authentication required', 401);
    }

    const dbService = new DatabaseService(env.DB);
    
    // 获取文件记录
    const fileRecord = await env.DB.prepare('SELECT * FROM files WHERE id = ?').bind(fileId).first();
    
    if (!fileRecord) {
      throw new ApiError('File not found', 404);
    }

    // 检查权限：只有文件上传者或管理员可以删除
    if (fileRecord.uploaded_by !== context.user.id && !hasPermission(context.user.role, 'admin')) {
      throw new ApiError('Permission denied', 403);
    }

    // 从 R2 删除文件
    const storageService = new StorageService(env.STORAGE);
    const deleted = await storageService.deleteFile(fileRecord.r2_key);
    
    if (!deleted) {
      throw new ApiError('Failed to delete file from storage', 500);
    }

    // 从数据库删除记录
    await env.DB.prepare('DELETE FROM files WHERE id = ?').bind(fileId).run();

    return createSuccessResponse({ message: 'File deleted successfully' });
  } catch (error) {
    console.error('Delete file error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to delete file', 500);
  }
}

/**
 * 获取存储使用情况
 */
export async function getStorageUsage(
  request: Request,
  env: Env,
  ctx: any,
  context: Context
): Promise<Response> {
  try {
    if (!context.user) {
      throw new ApiError('Authentication required', 401);
    }

    const storageService = new StorageService(env.STORAGE);
    
    // 管理员可以查看全部使用情况，其他用户只能查看自己的
    let prefix = '';
    if (!hasPermission(context.user.role, 'admin')) {
      prefix = `uploads/${context.user.id}/`;
    }

    const usage = await storageService.getStorageUsage(prefix);
    
    // 获取数据库中的文件统计
    const dbStats = await env.DB.prepare(`
      SELECT 
        COUNT(*) as total_files,
        SUM(size) as total_size,
        type,
        COUNT(*) as count
      FROM files 
      ${hasPermission(context.user.role, 'admin') ? '' : 'WHERE uploaded_by = ?'}
      GROUP BY type
    `).bind(...(hasPermission(context.user.role, 'admin') ? [] : [context.user.id])).all();

    return createSuccessResponse({
      storage: usage,
      database: dbStats.results,
    });
  } catch (error) {
    console.error('Get storage usage error:', error);
    return createErrorResponse(error instanceof ApiError ? error : 'Failed to get storage usage', 500);
  }
}
