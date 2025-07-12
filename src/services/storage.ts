import { FileUploadOptions, ApiError } from '../types';
import { generateId, getFileExtension, isAllowedFileType, formatFileSize } from '@/utils';

/**
 * R2 存储服务类
 */
export class StorageService {
  private bucket: any;
  private baseUrl: string;

  constructor(bucket: any, baseUrl: string = '') {
    this.bucket = bucket;
    this.baseUrl = baseUrl;
  }

  /**
   * 上传文件到 R2
   */
  async uploadFile(
    file: File | ArrayBuffer,
    originalName: string,
    options: FileUploadOptions = {}
  ): Promise<{
    key: string;
    url: string;
    size: number;
    type: string;
    name: string;
  }> {
    const {
      maxSize = 10 * 1024 * 1024, // 10MB
      allowedTypes = [
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
        'application/pdf',
        'text/plain',
      ],
      folder = 'uploads',
      isPublic = false,
    } = options;

    // 获取文件数据和信息
    let fileData: ArrayBuffer;
    let fileSize: number;
    let fileType: string;

    if (file instanceof File) {
      fileData = await file.arrayBuffer();
      fileSize = file.size;
      fileType = file.type;
    } else {
      fileData = file;
      fileSize = file.byteLength;
      fileType = this.getMimeTypeFromExtension(originalName);
    }

    // 验证文件大小
    if (fileSize > maxSize) {
      throw new ApiError(
        `File size ${formatFileSize(fileSize)} exceeds maximum allowed size ${formatFileSize(maxSize)}`,
        400
      );
    }

    // 验证文件类型
    if (!isAllowedFileType(fileType, allowedTypes)) {
      throw new ApiError(`File type ${fileType} is not allowed`, 400);
    }

    // 生成文件名和路径
    const extension = getFileExtension(originalName);
    const fileName = `${generateId()}.${extension}`;
    const key = `${folder}/${fileName}`;

    // 准备元数据
    const metadata = {
      originalName,
      uploadedAt: new Date().toISOString(),
      size: fileSize.toString(),
      type: fileType,
    };

    // 上传到 R2
    try {
      await this.bucket.put(key, fileData, {
        httpMetadata: {
          contentType: fileType,
          contentDisposition: `inline; filename="${originalName}"`,
        },
        customMetadata: metadata,
      });
    } catch (error) {
      console.error('R2 upload error:', error);
      throw new ApiError('Failed to upload file to storage', 500);
    }

    // 生成访问 URL
    const url = this.generateFileUrl(key, isPublic);

    return {
      key,
      url,
      size: fileSize,
      type: fileType,
      name: fileName,
    };
  }

  /**
   * 从 R2 获取文件
   */
  async getFile(key: string): Promise<any | null> {
    try {
      return await this.bucket.get(key);
    } catch (error) {
      console.error('R2 get error:', error);
      return null;
    }
  }

  /**
   * 删除文件
   */
  async deleteFile(key: string): Promise<boolean> {
    try {
      await this.bucket.delete(key);
      return true;
    } catch (error) {
      console.error('R2 delete error:', error);
      return false;
    }
  }

  /**
   * 批量删除文件
   */
  async deleteFiles(keys: string[]): Promise<{ success: string[]; failed: string[] }> {
    const success: string[] = [];
    const failed: string[] = [];

    await Promise.all(
      keys.map(async (key) => {
        const deleted = await this.deleteFile(key);
        if (deleted) {
          success.push(key);
        } else {
          failed.push(key);
        }
      })
    );

    return { success, failed };
  }

  /**
   * 列出文件
   */
  async listFiles(
    prefix: string = '',
    limit: number = 1000,
    cursor?: string
  ): Promise<{
    objects: any[];
    truncated: boolean;
    cursor?: string;
  }> {
    try {
      const result = await this.bucket.list({
        prefix,
        limit,
        cursor,
      });

      return {
        objects: result.objects,
        truncated: result.truncated,
        cursor: result.cursor,
      };
    } catch (error) {
      console.error('R2 list error:', error);
      throw new ApiError('Failed to list files', 500);
    }
  }

  /**
   * 获取文件信息
   */
  async getFileInfo(key: string): Promise<{
    size: number;
    type: string;
    lastModified: Date;
    metadata: Record<string, string>;
  } | null> {
    const object = await this.getFile(key);
    if (!object) return null;

    return {
      size: object.size,
      type: object.httpMetadata?.contentType || 'application/octet-stream',
      lastModified: object.uploaded,
      metadata: object.customMetadata || {},
    };
  }

  /**
   * 生成预签名 URL（用于直接上传）
   */
  async generatePresignedUrl(
    key: string,
    expiresIn: number = 3600
  ): Promise<string> {
    // 注意：Cloudflare R2 目前不支持预签名 URL
    // 这里返回一个占位符，实际使用时需要通过 API 上传
    throw new ApiError('Presigned URLs are not supported by Cloudflare R2', 501);
  }

  /**
   * 生成文件访问 URL
   */
  private generateFileUrl(key: string, isPublic: boolean): string {
    if (this.baseUrl) {
      return `${this.baseUrl}/${key}`;
    }
    
    // 如果没有自定义域名，返回相对路径
    // 实际访问时需要通过 API 代理
    return `/api/files/${key}`;
  }

  /**
   * 根据文件扩展名获取 MIME 类型
   */
  private getMimeTypeFromExtension(filename: string): string {
    const extension = getFileExtension(filename).toLowerCase();
    
    const mimeTypes: Record<string, string> = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'webp': 'image/webp',
      'pdf': 'application/pdf',
      'txt': 'text/plain',
      'md': 'text/markdown',
      'json': 'application/json',
      'xml': 'application/xml',
      'csv': 'text/csv',
      'zip': 'application/zip',
      'mp4': 'video/mp4',
      'mp3': 'audio/mpeg',
    };

    return mimeTypes[extension] || 'application/octet-stream';
  }

  /**
   * 验证图片文件
   */
  async validateImage(fileData: ArrayBuffer): Promise<{
    isValid: boolean;
    width?: number;
    height?: number;
    format?: string;
  }> {
    try {
      // 简单的图片格式检查
      const uint8Array = new Uint8Array(fileData);
      
      // JPEG
      if (uint8Array[0] === 0xFF && uint8Array[1] === 0xD8) {
        return { isValid: true, format: 'JPEG' };
      }
      
      // PNG
      if (uint8Array[0] === 0x89 && uint8Array[1] === 0x50 && 
          uint8Array[2] === 0x4E && uint8Array[3] === 0x47) {
        return { isValid: true, format: 'PNG' };
      }
      
      // GIF
      if (uint8Array[0] === 0x47 && uint8Array[1] === 0x49 && uint8Array[2] === 0x46) {
        return { isValid: true, format: 'GIF' };
      }
      
      // WebP
      if (uint8Array[8] === 0x57 && uint8Array[9] === 0x45 && 
          uint8Array[10] === 0x42 && uint8Array[11] === 0x50) {
        return { isValid: true, format: 'WebP' };
      }
      
      return { isValid: false };
    } catch {
      return { isValid: false };
    }
  }

  /**
   * 获取存储使用情况
   */
  async getStorageUsage(prefix: string = ''): Promise<{
    totalFiles: number;
    totalSize: number;
    sizeByType: Record<string, { count: number; size: number }>;
  }> {
    const { objects } = await this.listFiles(prefix);
    
    let totalFiles = 0;
    let totalSize = 0;
    const sizeByType: Record<string, { count: number; size: number }> = {};
    
    for (const object of objects) {
      totalFiles++;
      totalSize += object.size;
      
      const type = object.httpMetadata?.contentType || 'unknown';
      if (!sizeByType[type]) {
        sizeByType[type] = { count: 0, size: 0 };
      }
      sizeByType[type].count++;
      sizeByType[type].size += object.size;
    }
    
    return {
      totalFiles,
      totalSize,
      sizeByType,
    };
  }
}
