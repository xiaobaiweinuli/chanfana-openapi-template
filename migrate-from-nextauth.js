#!/usr/bin/env node

/**
 * NextAuth 到 Cloudflare Workers 迁移脚本
 * 
 * 使用方法:
 * node migrate-from-nextauth.js
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function main() {
  console.log('🚀 NextAuth 到 Cloudflare Workers 迁移工具\n');
  
  try {
    // 检查是否在正确的目录
    if (!fs.existsSync('package.json')) {
      console.error('❌ 请在项目根目录运行此脚本');
      process.exit(1);
    }
    
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    console.log(`📦 项目: ${packageJson.name}`);
    
    // 检查是否使用了 NextAuth
    const hasNextAuth = packageJson.dependencies?.['next-auth'] || 
                       packageJson.devDependencies?.['next-auth'];
    
    if (!hasNextAuth) {
      console.log('ℹ️  未检测到 NextAuth，跳过迁移步骤');
    } else {
      console.log('✅ 检测到 NextAuth，开始迁移配置');
    }
    
    // 获取用户输入
    const workerUrl = await question('🔗 请输入 Cloudflare Worker URL: ');
    const adminEmail = await question('👤 请输入管理员邮箱: ');
    
    // 更新环境变量
    await updateEnvFile(workerUrl, adminEmail);
    
    // 更新 Next.js 配置
    await updateNextConfig(workerUrl);
    
    // 创建迁移后的认证配置
    if (hasNextAuth) {
      await createMigratedAuthConfig();
    }
    
    // 创建 API 客户端
    await createApiClient(workerUrl);
    
    console.log('\n🎉 迁移完成！');
    console.log('\n📋 下一步操作:');
    console.log('1. 部署 Cloudflare Workers: cd workers && npm run deploy:dev');
    console.log('2. 重启开发服务器: npm run dev');
    console.log('3. 测试认证和 API 功能');
    console.log('4. 查看 COMPATIBILITY.md 了解详细信息');
    
  } catch (error) {
    console.error('❌ 迁移失败:', error.message);
    process.exit(1);
  } finally {
    rl.close();
  }
}

async function updateEnvFile(workerUrl, adminEmail) {
  console.log('\n📝 更新环境变量...');
  
  const envPath = '.env.local';
  let envContent = '';
  
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
  }
  
  // 添加或更新 Workers API URL
  if (!envContent.includes('NEXT_PUBLIC_API_URL')) {
    envContent += `\n# Cloudflare Workers API\nNEXT_PUBLIC_API_URL=${workerUrl}\n`;
  } else {
    envContent = envContent.replace(
      /NEXT_PUBLIC_API_URL=.*/,
      `NEXT_PUBLIC_API_URL=${workerUrl}`
    );
  }
  
  // 添加管理员邮箱
  if (!envContent.includes('ADMIN_EMAIL')) {
    envContent += `ADMIN_EMAIL=${adminEmail}\n`;
  }
  
  fs.writeFileSync(envPath, envContent);
  console.log('✅ 环境变量已更新');
}

async function updateNextConfig(workerUrl) {
  console.log('\n⚙️  更新 Next.js 配置...');
  
  const configPath = 'next.config.js';
  const configContent = `/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: '${workerUrl}/api/:path*',
      },
    ];
  },
  
  // 其他配置...
  experimental: {
    serverComponentsExternalPackages: [],
  },
};

module.exports = nextConfig;
`;
  
  // 备份原配置
  if (fs.existsSync(configPath)) {
    fs.copyFileSync(configPath, `${configPath}.backup`);
    console.log('📄 原配置已备份为 next.config.js.backup');
  }
  
  fs.writeFileSync(configPath, configContent);
  console.log('✅ Next.js 配置已更新');
}

async function createMigratedAuthConfig() {
  console.log('\n🔐 创建迁移后的认证配置...');
  
  const authConfigPath = 'lib/auth-migrated.ts';
  const authConfig = `import { NextAuthOptions } from "next-auth"
import GithubProvider from "next-auth/providers/github"

// 迁移后的认证配置
// 使用 Cloudflare Workers 后端进行认证
export const authOptions: NextAuthOptions = {
  providers: [
    GithubProvider({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    }),
  ],
  
  callbacks: {
    async signIn({ user, account }) {
      // Workers 后端会处理用户创建和角色分配
      return true;
    },
    
    async session({ session, token }) {
      // 从 Workers 后端获取最新用户信息
      if (process.env.NEXT_PUBLIC_API_URL) {
        try {
          const response = await fetch(\`\${process.env.NEXT_PUBLIC_API_URL}/api/auth/session\`, {
            headers: {
              'Authorization': \`Bearer \${token.sub}\`,
            },
          });
          
          if (response.ok) {
            const data = await response.json();
            if (data.success && data.data) {
              session = data.data;
            }
          }
        } catch (error) {
          console.error('Failed to fetch session from Workers:', error);
        }
      }
      
      return session;
    },
    
    async jwt({ token, user }) {
      return token;
    },
  },
  
  pages: {
    signIn: '/auth/signin',
    error: '/auth/error',
  },
  
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 天
  },
  
  secret: process.env.NEXTAUTH_SECRET,
};
`;
  
  // 确保 lib 目录存在
  if (!fs.existsSync('lib')) {
    fs.mkdirSync('lib');
  }
  
  fs.writeFileSync(authConfigPath, authConfig);
  console.log('✅ 迁移后的认证配置已创建: lib/auth-migrated.ts');
}

async function createApiClient(workerUrl) {
  console.log('\n🌐 创建 API 客户端...');
  
  const apiClientPath = 'lib/api-client.ts';
  const apiClient = `/**
 * Cloudflare Workers API 客户端
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '${workerUrl}';

export class ApiClient {
  private baseUrl: string;
  
  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }
  
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<{ success: boolean; data?: T; error?: string }> {
    const url = \`\${this.baseUrl}\${endpoint}\`;
    
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    
    return response.json();
  }
  
  // AI 功能
  async generateSummary(content: string, options?: any) {
    return this.request('/api/ai/summary', {
      method: 'POST',
      body: JSON.stringify({ content, options }),
    });
  }
  
  async recommendTags(title: string, content: string, options?: any) {
    return this.request('/api/ai/tags', {
      method: 'POST',
      body: JSON.stringify({ title, content, options }),
    });
  }
  
  async analyzeContent(title: string, content: string) {
    return this.request('/api/ai/analyze', {
      method: 'POST',
      body: JSON.stringify({ title, content }),
    });
  }
  
  // 文件管理
  async uploadFile(file: File, folder?: string, isPublic?: boolean) {
    const formData = new FormData();
    formData.append('file', file);
    if (folder) formData.append('folder', folder);
    if (isPublic !== undefined) formData.append('isPublic', String(isPublic));
    
    return fetch(\`\${this.baseUrl}/api/files/upload\`, {
      method: 'POST',
      body: formData,
    }).then(res => res.json());
  }
  
  async getFiles(params?: { page?: number; limit?: number; folder?: string }) {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.folder) searchParams.set('folder', params.folder);
    
    return this.request(\`/api/files?\${searchParams}\`);
  }
  
  // 搜索功能
  async search(query: string, params?: any) {
    const searchParams = new URLSearchParams({ q: query, ...params });
    return this.request(\`/api/search?\${searchParams}\`);
  }
  
  async advancedSearch(searchOptions: any) {
    return this.request('/api/search', {
      method: 'POST',
      body: JSON.stringify(searchOptions),
    });
  }
}

// 默认实例
export const apiClient = new ApiClient();

// 便捷函数
export const {
  generateSummary,
  recommendTags,
  analyzeContent,
  uploadFile,
  getFiles,
  search,
  advancedSearch,
} = apiClient;
`;
  
  // 确保 lib 目录存在
  if (!fs.existsSync('lib')) {
    fs.mkdirSync('lib');
  }
  
  fs.writeFileSync(apiClientPath, apiClient);
  console.log('✅ API 客户端已创建: lib/api-client.ts');
}

// 运行迁移脚本
main().catch(console.error);
