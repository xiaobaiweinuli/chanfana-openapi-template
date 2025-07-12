-- =============================================================================
-- 现代化博客系统 - 初始数据库架构
-- 迁移版本: 0001
-- 创建时间: 2024-01-01
-- =============================================================================

-- 用户表
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    username TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    avatar TEXT,
    bio TEXT,
    website TEXT,
    role TEXT NOT NULL DEFAULT 'user',
    github_id TEXT,
    github_username TEXT,
    email_verified BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    last_login_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 分类表
CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT,
    color TEXT,
    parent_id TEXT,
    order_index INTEGER DEFAULT 0,
    is_featured BOOLEAN DEFAULT FALSE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE SET NULL
);

-- 标签表
CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT,
    color TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 文章表
CREATE TABLE IF NOT EXISTS articles (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    excerpt TEXT,
    content TEXT NOT NULL,
    featured_image TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    category TEXT,
    tags TEXT, -- JSON array
    author_id TEXT NOT NULL,
    view_count INTEGER DEFAULT 0,
    like_count INTEGER DEFAULT 0,
    comment_count INTEGER DEFAULT 0,
    is_featured BOOLEAN DEFAULT FALSE,
    meta_title TEXT,
    meta_description TEXT,
    published_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (category) REFERENCES categories(slug) ON DELETE SET NULL
);

-- 页面表
CREATE TABLE IF NOT EXISTS pages (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    template TEXT,
    is_in_menu BOOLEAN DEFAULT FALSE,
    order_index INTEGER DEFAULT 0,
    parent_id TEXT,
    author_id TEXT NOT NULL,
    meta_title TEXT,
    meta_description TEXT,
    published_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES pages(id) ON DELETE SET NULL
);

-- 友情链接表
CREATE TABLE IF NOT EXISTS friend_links (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    description TEXT,
    avatar TEXT,
    category TEXT NOT NULL DEFAULT 'friend',
    contact_email TEXT,
    is_featured BOOLEAN DEFAULT FALSE,
    is_approved BOOLEAN DEFAULT FALSE,
    order_index INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 文件表
CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    url TEXT NOT NULL,
    alt_text TEXT,
    caption TEXT,
    uploader_id TEXT NOT NULL,
    folder TEXT DEFAULT '/',
    is_public BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (uploader_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 设置表
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    type TEXT DEFAULT 'string',
    description TEXT,
    is_public BOOLEAN DEFAULT FALSE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 文章浏览记录表
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
);

-- 网站分析表
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
);

-- =============================================================================
-- 索引创建
-- =============================================================================

-- 用户表索引
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_github_id ON users(github_id);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);

-- 分类表索引
CREATE INDEX IF NOT EXISTS idx_categories_slug ON categories(slug);
CREATE INDEX IF NOT EXISTS idx_categories_parent_id ON categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_categories_order_index ON categories(order_index);

-- 标签表索引
CREATE INDEX IF NOT EXISTS idx_tags_slug ON tags(slug);

-- 文章表索引
CREATE INDEX IF NOT EXISTS idx_articles_slug ON articles(slug);
CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status);
CREATE INDEX IF NOT EXISTS idx_articles_category ON articles(category);
CREATE INDEX IF NOT EXISTS idx_articles_author_id ON articles(author_id);
CREATE INDEX IF NOT EXISTS idx_articles_published_at ON articles(published_at);
CREATE INDEX IF NOT EXISTS idx_articles_created_at ON articles(created_at);
CREATE INDEX IF NOT EXISTS idx_articles_view_count ON articles(view_count);
CREATE INDEX IF NOT EXISTS idx_articles_is_featured ON articles(is_featured);

-- 页面表索引
CREATE INDEX IF NOT EXISTS idx_pages_slug ON pages(slug);
CREATE INDEX IF NOT EXISTS idx_pages_status ON pages(status);
CREATE INDEX IF NOT EXISTS idx_pages_author_id ON pages(author_id);
CREATE INDEX IF NOT EXISTS idx_pages_parent_id ON pages(parent_id);
CREATE INDEX IF NOT EXISTS idx_pages_is_in_menu ON pages(is_in_menu);
CREATE INDEX IF NOT EXISTS idx_pages_order_index ON pages(order_index);

-- 友情链接表索引
CREATE INDEX IF NOT EXISTS idx_friend_links_category ON friend_links(category);
CREATE INDEX IF NOT EXISTS idx_friend_links_is_approved ON friend_links(is_approved);
CREATE INDEX IF NOT EXISTS idx_friend_links_order_index ON friend_links(order_index);

-- 文件表索引
CREATE INDEX IF NOT EXISTS idx_files_uploader_id ON files(uploader_id);
CREATE INDEX IF NOT EXISTS idx_files_mime_type ON files(mime_type);
CREATE INDEX IF NOT EXISTS idx_files_folder ON files(folder);
CREATE INDEX IF NOT EXISTS idx_files_created_at ON files(created_at);

-- 设置表索引
CREATE INDEX IF NOT EXISTS idx_settings_is_public ON settings(is_public);

-- 文章浏览记录表索引
CREATE INDEX IF NOT EXISTS idx_article_views_article_id ON article_views(article_id);
CREATE INDEX IF NOT EXISTS idx_article_views_visitor_id ON article_views(visitor_id);
CREATE INDEX IF NOT EXISTS idx_article_views_viewed_at ON article_views(viewed_at);
CREATE INDEX IF NOT EXISTS idx_article_views_ip_address ON article_views(ip_address);

-- 网站分析表索引
CREATE INDEX IF NOT EXISTS idx_site_analytics_date ON site_analytics(date);
CREATE INDEX IF NOT EXISTS idx_site_analytics_page_path ON site_analytics(page_path);
CREATE INDEX IF NOT EXISTS idx_site_analytics_date_path ON site_analytics(date, page_path);

-- =============================================================================
-- 初始数据插入
-- =============================================================================

-- 插入默认设置
INSERT OR IGNORE INTO settings (key, value, type, description, is_public) VALUES
('site_name', '现代化博客系统', 'string', '网站名称', true),
('site_description', '基于 Next.js 和 Cloudflare Workers 的现代化博客系统', 'string', '网站描述', true),
('site_url', 'https://yourdomain.com', 'string', '网站URL', true),
('default_language', 'zh', 'string', '默认语言', true),
('timezone', 'Asia/Shanghai', 'string', '时区', false),
('posts_per_page', '10', 'number', '每页文章数', false),
('enable_comments', 'true', 'boolean', '启用评论', false),
('enable_analytics', 'true', 'boolean', '启用分析', false),
('enable_rss', 'true', 'boolean', '启用RSS', false),
('db_version', '1', 'number', '数据库版本', false),
('last_backup_time', '', 'string', '最后备份时间', false);

-- 插入默认分类
INSERT OR IGNORE INTO categories (id, name, slug, description, color) VALUES
('cat_tech', '技术', 'tech', '技术相关文章', '#3b82f6'),
('cat_life', '生活', 'life', '生活感悟和随笔', '#10b981'),
('cat_thoughts', '思考', 'thoughts', '个人思考和观点', '#8b5cf6'),
('cat_tutorials', '教程', 'tutorials', '技术教程和指南', '#f59e0b');

-- 插入默认标签
INSERT OR IGNORE INTO tags (id, name, slug, description, color) VALUES
('tag_nextjs', 'Next.js', 'nextjs', 'Next.js 相关内容', '#000000'),
('tag_react', 'React', 'react', 'React 相关内容', '#61dafb'),
('tag_typescript', 'TypeScript', 'typescript', 'TypeScript 相关内容', '#3178c6'),
('tag_cloudflare', 'Cloudflare', 'cloudflare', 'Cloudflare 相关内容', '#f38020'),
('tag_javascript', 'JavaScript', 'javascript', 'JavaScript 相关内容', '#f7df1e'),
('tag_css', 'CSS', 'css', 'CSS 相关内容', '#1572b6'),
('tag_html', 'HTML', 'html', 'HTML 相关内容', '#e34f26'),
('tag_nodejs', 'Node.js', 'nodejs', 'Node.js 相关内容', '#339933');

-- 插入默认友情链接分类
INSERT OR IGNORE INTO friend_links (id, name, url, description, category, is_approved) VALUES
('link_example', '示例链接', 'https://example.com', '这是一个示例友情链接', 'friend', true);
