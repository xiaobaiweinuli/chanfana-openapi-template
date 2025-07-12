# Modern Blog Cloudflare Workers Backend

这是现代化博客系统的 Cloudflare Workers 后端服务，提供完整的 API 支持。

## 功能特性

- ✅ GitHub OAuth 认证
- ✅ JWT Token 管理
- ✅ R2 文件存储
- ✅ D1 数据库集成
- ✅ AI 摘要生成
- ✅ 用户权限管理
- ✅ 速率限制
- ✅ CORS 支持
- ✅ 错误处理
- ✅ 定时任务

## 技术栈

- **Runtime**: Cloudflare Workers
- **Language**: TypeScript
- **Database**: Cloudflare D1
- **Storage**: Cloudflare R2
- **Cache**: Cloudflare KV
- **AI**: Cloudflare Workers AI

## 快速开始

### 1. 安装依赖

```bash
cd workers
npm install
```

### 2. 配置环境

复制 `wrangler.toml` 并根据你的需求修改配置：

```toml
name = "modern-blog-api"
main = "src/index.ts"
compatibility_date = "2024-12-01"
```

### 3. 创建 Cloudflare 资源

#### 创建 D1 数据库

```bash
# 创建数据库
wrangler d1 create modern-blog-db

# 执行 schema
wrangler d1 execute modern-blog-db --file=./schema.sql
```

#### 创建 KV 命名空间

```bash
# 创建缓存命名空间
wrangler kv:namespace create "CACHE"

# 创建会话命名空间  
wrangler kv:namespace create "SESSIONS"
```

#### 创建 R2 存储桶

```bash
# 创建存储桶
wrangler r2 bucket create modern-blog-storage
```

### 4. 设置环境变量

```bash
# 设置 GitHub Client Secret
wrangler secret put GITHUB_CLIENT_SECRET

# 设置 JWT 密钥
wrangler secret put JWT_SECRET

# 设置管理员邮箱列表 (JSON 数组)
wrangler secret put ADMIN_EMAILS
```

示例值：
- `GITHUB_CLIENT_SECRET`: `e52ad4d7a6a07a326666f2a3cd9e29ec6997c363`
- `JWT_SECRET`: 生成一个强密码，例如：`your-super-secret-jwt-key-here`
- `ADMIN_EMAILS`: `["admin@example.com", "owner@example.com"]`

### 5. 更新 wrangler.toml

将创建的资源 ID 更新到 `wrangler.toml` 中：

```toml
# KV 命名空间
[[kv_namespaces]]
binding = "CACHE"
id = "your-cache-kv-namespace-id"

[[kv_namespaces]]
binding = "SESSIONS"
id = "your-sessions-kv-namespace-id"

# D1 数据库
[[d1_databases]]
binding = "DB"
database_name = "modern-blog-db"
database_id = "your-d1-database-id"

# R2 存储桶
[[r2_buckets]]
binding = "STORAGE"
bucket_name = "modern-blog-storage"
```

### 6. 部署

```bash
# 开发环境部署
npm run deploy:dev

# 生产环境部署
npm run deploy:prod
```

## API 端点

### 认证相关

- `GET /api/auth/github/url` - 获取 GitHub OAuth 授权 URL
- `POST /api/auth/github/callback` - GitHub OAuth 回调处理
- `POST /api/auth/verify` - 验证 JWT Token
- `POST /api/auth/refresh` - 刷新 Token
- `POST /api/auth/logout` - 登出
- `GET /api/auth/me` - 获取当前用户信息
- `PUT /api/auth/me` - 更新用户信息

### 文件管理

- `POST /api/files/upload` - 上传文件
- `GET /api/files` - 获取文件列表
- `GET /api/files/{key}` - 获取文件内容
- `DELETE /api/files/{id}` - 删除文件
- `GET /api/files/usage` - 获取存储使用情况

### AI 功能

- `POST /api/ai/summary` - 生成文章摘要
- `POST /api/ai/tags` - 生成标签建议
- `POST /api/ai/analyze` - 分析内容质量
- `POST /api/ai/translate` - 翻译文本

### 系统

- `GET /api/health` - 健康检查

## 开发

### 本地开发

```bash
# 启动开发服务器
npm run dev
```

### 类型检查

```bash
npm run type-check
```

### 数据库操作

```bash
# 执行 SQL 文件
npm run db:generate

# 应用迁移
npm run db:migrate
```

## 配置说明

### GitHub OAuth 配置

在 GitHub 创建 OAuth App：

1. 访问 GitHub Settings > Developer settings > OAuth Apps
2. 点击 "New OAuth App"
3. 填写信息：
   - Application name: `Modern Blog`
   - Homepage URL: `http://localhost:3000` (开发) / `https://your-domain.com` (生产)
   - Authorization callback URL: `http://localhost:3000/auth/signin`
4. 获取 Client ID 和 Client Secret

### 环境变量

| 变量名 | 描述 | 示例 |
|--------|------|------|
| `GITHUB_CLIENT_SECRET` | GitHub OAuth Client Secret | `e52ad4d7a6a07a326666f2a3cd9e29ec6997c363` |
| `JWT_SECRET` | JWT 签名密钥 | `your-super-secret-jwt-key` |
| `ADMIN_EMAILS` | 管理员邮箱列表 (JSON) | `["admin@example.com"]` |

### 权限系统

- **admin**: 管理员，拥有所有权限
- **collaborator**: 协作者，可以管理内容
- **user**: 普通用户，只能查看公开内容

## 安全考虑

1. **JWT 密钥**: 使用强随机密钥
2. **CORS**: 只允许信任的域名
3. **速率限制**: 防止 API 滥用
4. **文件上传**: 限制文件类型和大小
5. **权限检查**: 严格的权限验证

## 监控和日志

- 所有请求都会记录日志
- 错误会自动上报到 Cloudflare
- 可以通过 Cloudflare Dashboard 查看指标

## 故障排除

### 常见问题

1. **数据库连接失败**
   - 检查 D1 数据库 ID 是否正确
   - 确保已执行 schema.sql

2. **文件上传失败**
   - 检查 R2 存储桶配置
   - 验证文件大小和类型限制

3. **AI 功能不工作**
   - 确保启用了 Workers AI
   - 检查模型是否可用

4. **认证失败**
   - 验证 GitHub OAuth 配置
   - 检查 JWT 密钥设置

### 调试

```bash
# 查看实时日志
wrangler tail

# 查看 KV 数据
wrangler kv:key list --binding=CACHE

# 查看数据库数据
wrangler d1 execute modern-blog-db --command="SELECT * FROM users LIMIT 5"
```

## 贡献

1. Fork 项目
2. 创建功能分支
3. 提交更改
4. 推送到分支
5. 创建 Pull Request

## 许可证

MIT License
