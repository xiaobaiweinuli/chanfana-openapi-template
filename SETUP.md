# Cloudflare Workers 后端设置指南

这是现代化博客系统 Cloudflare Workers 后端的完整设置指南。

## 🚀 快速开始

### 1. 前置要求

- Node.js 18+ 
- npm 或 yarn
- Cloudflare 账户
- GitHub 账户

### 2. 安装 Wrangler CLI

```bash
npm install -g wrangler
```

### 3. 登录 Cloudflare

```bash
wrangler login
```

### 4. 克隆并安装依赖

```bash
cd workers
npm install
```

## 📋 详细设置步骤

### 步骤 1: 创建 Cloudflare 资源

运行资源创建脚本：

```bash
# Windows
setup-resources.bat

# Linux/Mac
./setup-resources.sh
```

或手动创建：

```bash
# 创建 D1 数据库
wrangler d1 create modern-blog-db

# 创建 KV 命名空间
wrangler kv:namespace create "CACHE"
wrangler kv:namespace create "SESSIONS"

# 创建 R2 存储桶
wrangler r2 bucket create modern-blog-storage

# 执行数据库 schema
wrangler d1 execute modern-blog-db --file=./schema.sql
```

### 步骤 2: 更新 wrangler.toml

获取资源 ID：

```bash
wrangler d1 list
wrangler kv:namespace list
wrangler r2 bucket list
```

将获取的 ID 更新到 `wrangler.toml` 文件中：

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

### 步骤 3: 设置环境变量

运行环境变量设置脚本：

```bash
# Windows
setup-secrets.bat dev

# Linux/Mac
./setup-secrets.sh dev
```

或手动设置：

```bash
# GitHub Client Secret (已提供)
echo "e52ad4d7a6a07a326666f2a3cd9e29ec6997c363" | wrangler secret put GITHUB_CLIENT_SECRET --env development

# JWT Secret (生成强密钥)
echo "your-super-secret-jwt-key-here" | wrangler secret put JWT_SECRET --env development

# 管理员邮箱列表
echo '["your-email@example.com"]' | wrangler secret put ADMIN_EMAILS --env development
```

### 步骤 4: 配置 GitHub OAuth

1. 访问 [GitHub Developer Settings](https://github.com/settings/developers)
2. 点击 "New OAuth App"
3. 填写信息：
   - **Application name**: Modern Blog
   - **Homepage URL**: `http://localhost:3000`
   - **Authorization callback URL**: `http://localhost:3000/auth/signin`
4. 获取 Client ID: `Ov23lidzw6Hx0H5qVWSy` (已提供)
5. Client Secret 已在步骤 3 中设置

### 步骤 5: 部署

运行部署脚本：

```bash
# Windows
deploy.bat dev

# Linux/Mac
./deploy.sh dev
```

或手动部署：

```bash
# 开发环境
wrangler deploy --env development

# 生产环境
wrangler deploy --env production
```

## 🔧 配置说明

### GitHub OAuth 配置

| 字段 | 值 |
|------|-----|
| Client ID | `Ov23lidzw6Hx0H5qVWSy` |
| Client Secret | `e52ad4d7a6a07a326666f2a3cd9e29ec6997c363` |
| Homepage URL | `http://localhost:3000` (开发) |
| Callback URL | `http://localhost:3000/auth/signin` |

### 环境变量

| 变量名 | 描述 | 示例值 |
|--------|------|--------|
| `GITHUB_CLIENT_SECRET` | GitHub OAuth Secret | `e52ad4d7a6a07a326666f2a3cd9e29ec6997c363` |
| `JWT_SECRET` | JWT 签名密钥 | `your-super-secret-jwt-key` |
| `ADMIN_EMAILS` | 管理员邮箱 (JSON) | `["admin@example.com"]` |

### 权限系统

- **admin**: 完全访问权限
- **collaborator**: 内容管理权限
- **user**: 基础访问权限

## 🧪 测试部署

### 1. 健康检查

```bash
curl https://your-worker.your-subdomain.workers.dev/api/health
```

预期响应：
```json
{
  "success": true,
  "message": "API is healthy",
  "timestamp": "2024-12-01T12:00:00.000Z",
  "environment": "development"
}
```

### 2. GitHub OAuth URL

```bash
curl https://your-worker.your-subdomain.workers.dev/api/auth/github/url
```

### 3. 文件上传测试

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "file=@test.jpg" \
  https://your-worker.your-subdomain.workers.dev/api/files/upload
```

## 🔍 故障排除

### 常见问题

1. **部署失败**
   - 检查 wrangler.toml 配置
   - 确保所有资源 ID 正确
   - 验证环境变量设置

2. **数据库连接失败**
   - 确保 D1 数据库已创建
   - 检查 schema.sql 是否执行成功
   - 验证数据库 ID 配置

3. **文件上传失败**
   - 检查 R2 存储桶配置
   - 验证文件大小和类型限制
   - 确保用户有上传权限

4. **AI 功能不工作**
   - 确保 Workers AI 已启用
   - 检查模型可用性
   - 验证请求格式

### 调试命令

```bash
# 查看实时日志
wrangler tail

# 查看 KV 数据
wrangler kv:key list --binding=CACHE

# 查看数据库数据
wrangler d1 execute modern-blog-db --command="SELECT * FROM users LIMIT 5"

# 测试数据库连接
wrangler d1 execute modern-blog-db --command="SELECT 1"
```

## 📚 API 文档

### 认证端点

- `GET /api/auth/github/url` - 获取 GitHub OAuth URL
- `POST /api/auth/github/callback` - GitHub OAuth 回调
- `POST /api/auth/verify` - 验证 JWT Token
- `GET /api/auth/me` - 获取当前用户

### 文件端点

- `POST /api/files/upload` - 上传文件
- `GET /api/files` - 获取文件列表
- `GET /api/files/{key}` - 下载文件
- `DELETE /api/files/{id}` - 删除文件

### AI 端点

- `POST /api/ai/summary` - 生成摘要
- `POST /api/ai/tags` - 生成标签
- `POST /api/ai/analyze` - 内容分析

## 🔄 更新和维护

### 更新代码

```bash
git pull origin main
npm install
wrangler deploy --env development
```

### 数据库迁移

```bash
# 执行新的迁移文件
wrangler d1 execute modern-blog-db --file=./migrations/001_add_new_table.sql
```

### 监控

- 使用 Cloudflare Dashboard 查看指标
- 设置告警规则
- 定期检查日志

## 🆘 获取帮助

如果遇到问题：

1. 检查 [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
2. 查看 [Wrangler CLI 文档](https://developers.cloudflare.com/workers/wrangler/)
3. 在项目 GitHub 仓库提交 Issue
4. 联系技术支持
