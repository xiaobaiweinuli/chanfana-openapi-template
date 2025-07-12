import { GitHubUser, GitHubTokenResponse, ApiError } from '../types';
import { isAdminEmail } from '@/utils/jwt';

/**
 * GitHub OAuth 服务类
 */
export class GitHubService {
  private clientId: string = 'Ov23lidzw6Hx0H5qVWSy';
  private clientSecret: string;
  private redirectUri: string;

  constructor(clientSecret: string, frontendUrl: string) {
    this.clientSecret = clientSecret;
    this.redirectUri = `${frontendUrl}/auth/signin`;
  }

  /**
   * 生成 GitHub OAuth 授权 URL
   */
  getAuthUrl(state?: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      scope: 'user:email',
      state: state || '',
    });

    return `https://github.com/login/oauth/authorize?${params.toString()}`;
  }

  /**
   * 使用授权码获取访问令牌
   */
  async getAccessToken(code: string): Promise<string> {
    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
        redirect_uri: this.redirectUri,
      }),
    });

    if (!response.ok) {
      throw new ApiError('Failed to get access token from GitHub', 400);
    }

    const data: GitHubTokenResponse = await response.json();
    
    if (!data.access_token) {
      throw new ApiError('No access token received from GitHub', 400);
    }

    return data.access_token;
  }

  /**
   * 使用访问令牌获取用户信息
   */
  async getUserInfo(accessToken: string): Promise<GitHubUser> {
    const response = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Modern-Blog-App',
      },
    });

    if (!response.ok) {
      throw new ApiError('Failed to get user info from GitHub', 400);
    }

    const user = await response.json() as any;

    // 如果用户没有公开邮箱，获取主邮箱
    if (!user.email) {
      const emailResponse = await fetch('https://api.github.com/user/emails', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Modern-Blog-App',
        },
      });

      if (emailResponse.ok) {
        const emails = await emailResponse.json() as any[];
        const primaryEmail = emails.find((email: any) => email.primary);
        if (primaryEmail) {
          user.email = primaryEmail.email;
        }
      }
    }

    if (!user.email) {
      throw new ApiError('Unable to get user email from GitHub', 400);
    }

    return {
      id: user.id,
      login: user.login,
      email: user.email,
      name: user.name || user.login,
      avatar_url: user.avatar_url,
      bio: user.bio,
      location: user.location,
      blog: user.blog,
    };
  }

  /**
   * 完整的 OAuth 流程：从授权码到用户信息
   */
  async authenticateUser(code: string, adminEmails: string[] = []): Promise<{
    user: GitHubUser;
    role: 'admin' | 'collaborator' | 'user';
  }> {
    // 获取访问令牌
    const accessToken = await this.getAccessToken(code);
    
    // 获取用户信息
    const user = await this.getUserInfo(accessToken);
    
    // 确定用户角色
    let role: 'admin' | 'collaborator' | 'user' = 'user';
    
    if (isAdminEmail(user.email, adminEmails)) {
      role = 'admin';
    }
    // 可以在这里添加更多角色判断逻辑
    // 例如：检查用户是否在协作者列表中
    
    return { user, role };
  }

  /**
   * 验证 GitHub 用户是否有效
   */
  async validateUser(accessToken: string): Promise<boolean> {
    try {
      const response = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Modern-Blog-App',
        },
      });

      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * 获取用户的公开仓库信息（可选功能）
   */
  async getUserRepos(accessToken: string, page: number = 1, perPage: number = 30): Promise<any[]> {
    const response = await fetch(`https://api.github.com/user/repos?page=${page}&per_page=${perPage}&sort=updated`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Modern-Blog-App',
      },
    });

    if (!response.ok) {
      throw new ApiError('Failed to get user repositories from GitHub', 400);
    }

    return response.json();
  }

  /**
   * 检查用户是否为组织成员（可选功能）
   */
  async isOrganizationMember(accessToken: string, org: string, username: string): Promise<boolean> {
    try {
      const response = await fetch(`https://api.github.com/orgs/${org}/members/${username}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Modern-Blog-App',
        },
      });

      return response.status === 204; // 204 表示是成员
    } catch {
      return false;
    }
  }

  /**
   * 撤销访问令牌
   */
  async revokeToken(accessToken: string): Promise<boolean> {
    try {
      const response = await fetch(`https://api.github.com/applications/${this.clientId}/token`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Basic ${btoa(`${this.clientId}:${this.clientSecret}`)}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Modern-Blog-App',
        },
        body: JSON.stringify({
          access_token: accessToken,
        }),
      });

      return response.ok;
    } catch {
      return false;
    }
  }
}
