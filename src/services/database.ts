import { User, Article, FileRecord, FriendLink, QueryOptions, PaginatedResponse, WorkersD1Database } from '../types';
import { generateId, calculatePagination } from '../utils';

/**
 * 数据库服务类
 */
export class DatabaseService {
  private db: any;

  constructor(db: any) {
    this.db = db;
  }

  // ==================== 用户相关 ====================

  /**
   * 根据 GitHub ID 获取用户
   */
  async getUserByGitHubId(githubId: number): Promise<User | null> {
    const result = await this.db.prepare(
      'SELECT * FROM users WHERE github_id = ?'
    ).bind(githubId).first();

    return result ? this.mapUser(result) : null;
  }

  /**
   * 根据 ID 获取用户
   */
  async getUserById(id: string): Promise<User | null> {
    const result = await this.db.prepare(
      'SELECT * FROM users WHERE id = ?'
    ).bind(id).first();

    return result ? this.mapUser(result) : null;
  }

  /**
   * 创建或更新用户
   */
  async upsertUser(userData: Partial<User> & { github_id: number }): Promise<User> {
    const existingUser = await this.getUserByGitHubId(userData.github_id);
    
    if (existingUser) {
      // 更新用户
      const updatedUser = { ...existingUser, ...userData, updated_at: new Date().toISOString() };
      await this.db.prepare(`
        UPDATE users SET 
          username = ?, email = ?, name = ?, avatar_url = ?, 
          bio = ?, location = ?, website = ?, updated_at = ?, last_login_at = ?
        WHERE id = ?
      `).bind(
        updatedUser.username,
        updatedUser.email,
        updatedUser.name,
        updatedUser.avatar_url,
        updatedUser.bio,
        updatedUser.location,
        updatedUser.website,
        updatedUser.updated_at,
        new Date().toISOString(),
        updatedUser.id
      ).run();
      
      return updatedUser;
    } else {
      // 创建新用户
      const newUser: User = {
        id: generateId(),
        github_id: userData.github_id,
        username: userData.username || '',
        email: userData.email || '',
        name: userData.name || '',
        avatar_url: userData.avatar_url,
        role: userData.role || 'user',
        bio: userData.bio,
        location: userData.location,
        website: userData.website,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_login_at: new Date().toISOString(),
        is_active: true,
      };

      await this.db.prepare(`
        INSERT INTO users (
          id, github_id, username, email, name, avatar_url, role,
          bio, location, website, created_at, updated_at, last_login_at, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        newUser.id,
        newUser.github_id,
        newUser.username,
        newUser.email,
        newUser.name,
        newUser.avatar_url,
        newUser.role,
        newUser.bio,
        newUser.location,
        newUser.website,
        newUser.created_at,
        newUser.updated_at,
        newUser.last_login_at,
        newUser.is_active
      ).run();

      return newUser;
    }
  }

  /**
   * 获取用户列表
   */
  async getUsers(options: QueryOptions = {}): Promise<PaginatedResponse<User>> {
    const { limit = 20, offset = 0, orderBy = 'created_at DESC' } = options;
    
    // 获取总数
    const countResult = await this.db.prepare('SELECT COUNT(*) as count FROM users').first();
    const total = countResult?.count as number || 0;
    
    // 获取用户列表
    const results = await this.db.prepare(`
      SELECT * FROM users ORDER BY ${orderBy} LIMIT ? OFFSET ?
    `).bind(limit, offset).all();

    const users = results.results.map(this.mapUser);
    const pagination = calculatePagination(Math.floor(offset / limit) + 1, limit, total);

    return { items: users, pagination };
  }

  // ==================== 文章相关 ====================

  /**
   * 创建文章
   */
  async createArticle(articleData: Omit<Article, 'id' | 'created_at' | 'updated_at'>): Promise<Article> {
    const article: Article = {
      id: generateId(),
      ...articleData,
      tags: Array.isArray(articleData.tags) ? articleData.tags : [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await this.db.prepare(`
      INSERT INTO articles (
        id, title, slug, content, excerpt, summary, cover_image, status,
        category, tags, author_id, published_at, created_at, updated_at,
        view_count, like_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      article.id,
      article.title,
      article.slug,
      article.content,
      article.excerpt,
      article.summary,
      article.cover_image,
      article.status,
      article.category,
      JSON.stringify(article.tags),
      article.author_id,
      article.published_at,
      article.created_at,
      article.updated_at,
      article.view_count,
      article.like_count
    ).run();

    return article;
  }

  /**
   * 根据 slug 获取文章
   */
  async getArticleBySlug(slug: string): Promise<Article | null> {
    const result = await this.db.prepare(
      'SELECT * FROM articles WHERE slug = ?'
    ).bind(slug).first();

    return result ? this.mapArticle(result) : null;
  }

  /**
   * 获取文章列表
   */
  async getArticles(options: QueryOptions & { status?: string; author_id?: string } = {}): Promise<PaginatedResponse<Article>> {
    const { limit = 20, offset = 0, orderBy = 'created_at DESC', status, author_id } = options;
    
    let whereClause = '';
    const bindings: any[] = [];
    
    if (status) {
      whereClause += ' WHERE status = ?';
      bindings.push(status);
    }
    
    if (author_id) {
      whereClause += whereClause ? ' AND author_id = ?' : ' WHERE author_id = ?';
      bindings.push(author_id);
    }

    // 获取总数
    const countResult = await this.db.prepare(
      `SELECT COUNT(*) as count FROM articles${whereClause}`
    ).bind(...bindings).first();
    const total = countResult?.count as number || 0;
    
    // 获取文章列表
    const results = await this.db.prepare(`
      SELECT * FROM articles${whereClause} ORDER BY ${orderBy} LIMIT ? OFFSET ?
    `).bind(...bindings, limit, offset).all();

    const articles = results.results.map(this.mapArticle);
    const pagination = calculatePagination(Math.floor(offset / limit) + 1, limit, total);

    return { items: articles, pagination };
  }

  // ==================== 文件相关 ====================

  /**
   * 创建文件记录
   */
  async createFile(fileData: Omit<FileRecord, 'id' | 'uploaded_at'>): Promise<FileRecord> {
    const file: FileRecord = {
      id: generateId(),
      ...fileData,
      uploaded_at: new Date().toISOString(),
    };

    await this.db.prepare(`
      INSERT INTO files (
        id, name, original_name, size, type, url, r2_key,
        uploaded_by, uploaded_at, is_public, folder, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      file.id,
      file.name,
      file.original_name,
      file.size,
      file.type,
      file.url,
      file.r2_key,
      file.uploaded_by,
      file.uploaded_at,
      file.is_public,
      file.folder,
      JSON.stringify(file.metadata || {})
    ).run();

    return file;
  }

  /**
   * 获取文件列表
   */
  async getFiles(options: QueryOptions & { uploaded_by?: string; folder?: string } = {}): Promise<PaginatedResponse<FileRecord>> {
    const { limit = 20, offset = 0, orderBy = 'uploaded_at DESC', uploaded_by, folder } = options;
    
    let whereClause = '';
    const bindings: any[] = [];
    
    if (uploaded_by) {
      whereClause += ' WHERE uploaded_by = ?';
      bindings.push(uploaded_by);
    }
    
    if (folder) {
      whereClause += whereClause ? ' AND folder = ?' : ' WHERE folder = ?';
      bindings.push(folder);
    }

    // 获取总数
    const countResult = await this.db.prepare(
      `SELECT COUNT(*) as count FROM files${whereClause}`
    ).bind(...bindings).first();
    const total = countResult?.count as number || 0;
    
    // 获取文件列表
    const results = await this.db.prepare(`
      SELECT * FROM files${whereClause} ORDER BY ${orderBy} LIMIT ? OFFSET ?
    `).bind(...bindings, limit, offset).all();

    const files = results.results.map(this.mapFile);
    const pagination = calculatePagination(Math.floor(offset / limit) + 1, limit, total);

    return { items: files, pagination };
  }

  // ==================== 友情链接相关 ====================

  /**
   * 创建友情链接
   */
  async createFriendLink(linkData: Omit<FriendLink, 'id' | 'created_at' | 'updated_at'>): Promise<FriendLink> {
    const link: FriendLink = {
      id: generateId(),
      ...linkData,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await this.db.prepare(`
      INSERT INTO friend_links (
        id, name, url, description, avatar, category, status,
        order_index, created_at, updated_at, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      link.id,
      link.name,
      link.url,
      link.description,
      link.avatar,
      link.category,
      link.status,
      link.order_index,
      link.created_at,
      link.updated_at,
      link.created_by
    ).run();

    return link;
  }

  /**
   * 获取友情链接列表
   */
  async getFriendLinks(options: QueryOptions & { status?: string; category?: string } = {}): Promise<FriendLink[]> {
    const { orderBy = 'order_index ASC', status, category } = options;
    
    let whereClause = '';
    const bindings: any[] = [];
    
    if (status) {
      whereClause += ' WHERE status = ?';
      bindings.push(status);
    }
    
    if (category) {
      whereClause += whereClause ? ' AND category = ?' : ' WHERE category = ?';
      bindings.push(category);
    }

    const results = await this.db.prepare(`
      SELECT * FROM friend_links${whereClause} ORDER BY ${orderBy}
    `).bind(...bindings).all();

    return results.results.map(this.mapFriendLink);
  }

  // ==================== 映射函数 ====================

  private mapUser(row: any): User {
    return {
      ...row,
      is_active: Boolean(row.is_active),
    };
  }

  private mapArticle(row: any): Article {
    return {
      ...row,
      tags: JSON.parse(row.tags || '[]'),
      view_count: Number(row.view_count),
      like_count: Number(row.like_count),
    };
  }

  private mapFile(row: any): FileRecord {
    return {
      ...row,
      size: Number(row.size),
      is_public: Boolean(row.is_public),
      metadata: JSON.parse(row.metadata || '{}'),
    };
  }

  private mapFriendLink(row: any): FriendLink {
    return {
      ...row,
      order_index: Number(row.order_index),
    };
  }
}
