-- 用户表
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    github_id INTEGER UNIQUE NOT NULL,
    username TEXT NOT NULL,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    avatar_url TEXT,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'collaborator', 'user')),
    bio TEXT,
    location TEXT,
    website TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login_at DATETIME,
    is_active BOOLEAN DEFAULT TRUE
);

-- 文章表
CREATE TABLE IF NOT EXISTS articles (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    content TEXT NOT NULL,
    excerpt TEXT,
    summary TEXT, -- AI 生成的摘要
    cover_image TEXT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
    category TEXT NOT NULL,
    tags TEXT, -- JSON 数组字符串
    author_id TEXT NOT NULL,
    published_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    view_count INTEGER DEFAULT 0,
    like_count INTEGER DEFAULT 0,
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 文件表
CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    original_name TEXT NOT NULL,
    size INTEGER NOT NULL,
    type TEXT NOT NULL,
    url TEXT NOT NULL,
    r2_key TEXT NOT NULL, -- R2 存储的 key
    uploaded_by TEXT NOT NULL,
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_public BOOLEAN DEFAULT FALSE,
    folder TEXT DEFAULT '/', -- 文件夹路径
    metadata TEXT, -- JSON 字符串，存储额外信息
    FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE CASCADE
);

-- 友情链接表
CREATE TABLE IF NOT EXISTS friend_links (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    description TEXT NOT NULL,
    avatar TEXT,
    category TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('active', 'inactive', 'pending')),
    order_index INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- 用户会话表 (可选，也可以只用 KV)
CREATE TABLE IF NOT EXISTS user_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    user_agent TEXT,
    ip_address TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 分类表
CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT,
    color TEXT DEFAULT '#3b82f6',
    order_index INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- 标签表
CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT,
    color TEXT DEFAULT '#10b981',
    order_index INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- 页面表
CREATE TABLE IF NOT EXISTS pages (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    content TEXT NOT NULL,
    excerpt TEXT,
    meta_title TEXT,
    meta_description TEXT,
    status TEXT CHECK (status IN ('draft', 'published', 'private')) DEFAULT 'draft',
    template TEXT DEFAULT 'default',
    order_index INTEGER DEFAULT 0,
    is_in_menu BOOLEAN DEFAULT false,
    menu_title TEXT,
    parent_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    published_at DATETIME,
    created_by TEXT,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (parent_id) REFERENCES pages(id) ON DELETE SET NULL
);

-- 友情链接表
CREATE TABLE IF NOT EXISTS friend_links (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    description TEXT,
    avatar TEXT,
    category TEXT DEFAULT 'friend',
    status TEXT CHECK (status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
    order_index INTEGER DEFAULT 0,
    is_featured BOOLEAN DEFAULT false,
    contact_email TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    approved_at DATETIME,
    created_by TEXT,
    approved_by TEXT,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
);

-- 文章浏览统计表
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

-- 网站访问统计表
CREATE TABLE IF NOT EXISTS site_analytics (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL, -- YYYY-MM-DD 格式
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

-- 系统设置表
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_by TEXT,
    FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_users_github_id ON users(github_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

CREATE INDEX IF NOT EXISTS idx_articles_slug ON articles(slug);
CREATE INDEX IF NOT EXISTS idx_articles_author_id ON articles(author_id);
CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status);
CREATE INDEX IF NOT EXISTS idx_articles_category ON articles(category);
CREATE INDEX IF NOT EXISTS idx_articles_published_at ON articles(published_at);

CREATE INDEX IF NOT EXISTS idx_files_uploaded_by ON files(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_files_type ON files(type);
CREATE INDEX IF NOT EXISTS idx_files_folder ON files(folder);

CREATE INDEX IF NOT EXISTS idx_friend_links_status ON friend_links(status);
CREATE INDEX IF NOT EXISTS idx_friend_links_category ON friend_links(category);
CREATE INDEX IF NOT EXISTS idx_friend_links_order ON friend_links(order_index);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON user_sessions(expires_at);

CREATE INDEX IF NOT EXISTS idx_categories_slug ON categories(slug);
CREATE INDEX IF NOT EXISTS idx_categories_order ON categories(order_index);

CREATE INDEX IF NOT EXISTS idx_tags_slug ON tags(slug);
CREATE INDEX IF NOT EXISTS idx_tags_order ON tags(order_index);

CREATE INDEX IF NOT EXISTS idx_pages_slug ON pages(slug);
CREATE INDEX IF NOT EXISTS idx_pages_status ON pages(status);
CREATE INDEX IF NOT EXISTS idx_pages_order ON pages(order_index);
CREATE INDEX IF NOT EXISTS idx_pages_parent ON pages(parent_id);

CREATE INDEX IF NOT EXISTS idx_article_views_article_id ON article_views(article_id);
CREATE INDEX IF NOT EXISTS idx_article_views_viewed_at ON article_views(viewed_at);
CREATE INDEX IF NOT EXISTS idx_article_views_visitor_id ON article_views(visitor_id);

CREATE INDEX IF NOT EXISTS idx_site_analytics_date ON site_analytics(date);
CREATE INDEX IF NOT EXISTS idx_site_analytics_page_path ON site_analytics(page_path);
CREATE INDEX IF NOT EXISTS idx_site_analytics_date_path ON site_analytics(date, page_path);

CREATE INDEX IF NOT EXISTS idx_friend_links_status ON friend_links(status);
CREATE INDEX IF NOT EXISTS idx_friend_links_category ON friend_links(category);
CREATE INDEX IF NOT EXISTS idx_friend_links_order ON friend_links(order_index);

-- 插入默认分类
INSERT OR IGNORE INTO categories (id, name, slug, description, color, order_index) VALUES
('cat_tech', '技术', 'tech', '技术相关文章', '#3b82f6', 1),
('cat_life', '生活', 'life', '生活感悟和分享', '#10b981', 2),
('cat_uncategorized', '未分类', 'uncategorized', '未分类文章', '#6b7280', 999);

-- 插入默认标签
INSERT OR IGNORE INTO tags (id, name, slug, description, color, order_index) VALUES
('tag_react', 'React', 'react', 'React 相关内容', '#61dafb', 1),
('tag_typescript', 'TypeScript', 'typescript', 'TypeScript 相关内容', '#3178c6', 2),
('tag_nextjs', 'Next.js', 'nextjs', 'Next.js 相关内容', '#000000', 3),
('tag_javascript', 'JavaScript', 'javascript', 'JavaScript 相关内容', '#f7df1e', 4),
('tag_css', 'CSS', 'css', 'CSS 相关内容', '#1572b6', 5);

-- 插入默认页面
INSERT OR IGNORE INTO pages (id, title, slug, content, excerpt, status, is_in_menu, menu_title, order_index) VALUES
('page_about', '关于我们', 'about', '# 关于我们\n\n这里是关于页面的内容...', '了解更多关于我们的信息', 'published', true, '关于', 1),
('page_contact', '联系我们', 'contact', '# 联系我们\n\n如有任何问题，请随时联系我们...', '联系方式和反馈渠道', 'published', true, '联系', 2),
('page_privacy', '隐私政策', 'privacy', '# 隐私政策\n\n我们重视您的隐私...', '了解我们如何保护您的隐私', 'published', false, null, 3),
('page_terms', '服务条款', 'terms', '# 服务条款\n\n使用本网站即表示您同意以下条款...', '网站使用条款和条件', 'published', false, null, 4);

-- 插入默认友情链接
INSERT OR IGNORE INTO friend_links (id, name, url, description, category, status, order_index, is_featured) VALUES
('link_nextjs', 'Next.js', 'https://nextjs.org', 'React 全栈框架', 'tech', 'approved', 1, true),
('link_vercel', 'Vercel', 'https://vercel.com', '现代化部署平台', 'tech', 'approved', 2, true),
('link_tailwind', 'Tailwind CSS', 'https://tailwindcss.com', '实用优先的 CSS 框架', 'tech', 'approved', 3, false),
('link_cloudflare', 'Cloudflare', 'https://cloudflare.com', '全球 CDN 和安全服务', 'tech', 'approved', 4, false);

-- 插入默认设置
INSERT OR IGNORE INTO settings (key, value, description) VALUES
('site_name', 'Modern Blog', '网站名称'),
('site_description', '现代化的技术博客平台', '网站描述'),
('max_file_size', '10485760', '最大文件上传大小 (10MB)'),
('allowed_file_types', '["image/jpeg","image/png","image/gif","image/webp","application/pdf","text/plain"]', '允许的文件类型'),
('admin_emails', '[]', '管理员邮箱列表 (JSON 数组)');

-- 创建触发器，自动更新 updated_at 字段
CREATE TRIGGER IF NOT EXISTS update_users_updated_at 
    AFTER UPDATE ON users
    BEGIN
        UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;

CREATE TRIGGER IF NOT EXISTS update_articles_updated_at 
    AFTER UPDATE ON articles
    BEGIN
        UPDATE articles SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;

CREATE TRIGGER IF NOT EXISTS update_friend_links_updated_at 
    AFTER UPDATE ON friend_links
    BEGIN
        UPDATE friend_links SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;
