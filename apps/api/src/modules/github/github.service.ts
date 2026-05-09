import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Octokit } from '@octokit/rest';
import { TokenService } from '../auth/token.service';
import { PrismaService } from '../../database/prisma.service';

export interface PullRequestDiff {
  prNumber: number;
  title: string;
  baseSha: string;
  headSha: string;
  files: DiffFile[];
}

export interface DiffFile {
  filename: string;
  status: 'added' | 'modified' | 'removed' | 'renamed';
  additions: number;
  deletions: number;
  patch?: string;        // Unified diff patch
  rawContent?: string;   // Full file content (for context)
  language: string;
}

@Injectable()
export class GitHubService {
  private readonly logger = new Logger(GitHubService.name);

  constructor(
    private prisma: PrismaService,
    private tokenService: TokenService,
  ) {}

  private async getOctokitForUser(userId: string): Promise<Octokit> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { githubTokenEnc: true },
    });

    if (!user.githubTokenEnc) {
      throw new NotFoundException('GitHub account not connected');
    }

    const token = this.tokenService.decryptGitHubToken(user.githubTokenEnc);
    return new Octokit({ auth: token });
  }

  private async getOctokitForRepo(repoId: string): Promise<Octokit> {
    const repo = await this.prisma.repository.findUniqueOrThrow({
      where: { id: repoId },
      include: {
        organization: {
          include: {
            members: {
              where: { role: { in: ['OWNER', 'ADMIN'] } },
              include: { user: { select: { id: true, githubTokenEnc: true } } },
              take: 1,
            },
          },
        },
      },
    });

    const ownerMember = repo.organization.members[0];
    if (!ownerMember?.user?.githubTokenEnc) {
      throw new NotFoundException('No GitHub token available for this organization');
    }

    const token = this.tokenService.decryptGitHubToken(ownerMember.user.githubTokenEnc);
    return new Octokit({ auth: token });
  }

  async listUserRepositories(userId: string, page = 1, perPage = 30) {
    const octokit = await this.getOctokitForUser(userId);
    const { data } = await octokit.repos.listForAuthenticatedUser({
      sort: 'updated',
      per_page: perPage,
      page,
      affiliation: 'owner,organization_member,collaborator',
    });

    return data.map((repo) => ({
      githubId: repo.id,
      fullName: repo.full_name,
      name: repo.name,
      ownerLogin: repo.owner.login,
      isPrivate: repo.private,
      description: repo.description ?? null,
      defaultBranch: repo.default_branch,
      language: repo.language ?? null,
      htmlUrl: repo.html_url,
      cloneUrl: repo.clone_url,
      updatedAt: repo.updated_at,
      starCount: repo.stargazers_count,
    }));
  }

  async getPullRequest(repoId: string, prNumber: number) {
    const repo = await this.prisma.repository.findUniqueOrThrow({
      where: { id: repoId },
    });
    const octokit = await this.getOctokitForRepo(repoId);

    const { data } = await octokit.pulls.get({
      owner: repo.ownerLogin,
      repo: repo.name,
      pull_number: prNumber,
    });

    return data;
  }

  async getPullRequestDiff(repoId: string, prNumber: number): Promise<PullRequestDiff> {
    const repo = await this.prisma.repository.findUniqueOrThrow({
      where: { id: repoId },
    });
    const octokit = await this.getOctokitForRepo(repoId);

    const [prData, filesData] = await Promise.all([
      octokit.pulls.get({
        owner: repo.ownerLogin,
        repo: repo.name,
        pull_number: prNumber,
      }),
      octokit.pulls.listFiles({
        owner: repo.ownerLogin,
        repo: repo.name,
        pull_number: prNumber,
        per_page: 100,
      }),
    ]);

    const files: DiffFile[] = await Promise.all(
      filesData.data
        .filter((f) => this.isReviewableFile(f.filename))
        .map(async (file) => {
          let rawContent: string | undefined;

          // Fetch full file content for better AI context (not just the diff)
          if (file.status !== 'removed' && (file.additions + file.deletions) < 500) {
            rawContent = await this.getFileContent(
              octokit,
              repo.ownerLogin,
              repo.name,
              file.filename,
              prData.data.head.sha,
            );
          }

          return {
            filename: file.filename,
            status: file.status as DiffFile['status'],
            additions: file.additions,
            deletions: file.deletions,
            patch: file.patch,
            rawContent,
            language: this.detectLanguage(file.filename),
          };
        }),
    );

    return {
      prNumber,
      title: prData.data.title,
      baseSha: prData.data.base.sha,
      headSha: prData.data.head.sha,
      files,
    };
  }

  async postReviewComment(
    repoId: string,
    prNumber: number,
    comment: {
      body: string;
      path: string;
      line: number;
      side?: 'LEFT' | 'RIGHT';
    },
  ): Promise<any> {
    const repo = await this.prisma.repository.findUniqueOrThrow({
      where: { id: repoId },
    });
    const octokit = await this.getOctokitForRepo(repoId);

    const pr = await octokit.pulls.get({
      owner: repo.ownerLogin,
      repo: repo.name,
      pull_number: prNumber,
    });

    return octokit.pulls.createReviewComment({
      owner: repo.ownerLogin,
      repo: repo.name,
      pull_number: prNumber,
      commit_id: pr.data.head.sha,
      path: comment.path,
      line: comment.line,
      side: comment.side ?? 'RIGHT',
      body: comment.body,
    });
  }

  async submitPRReview(
    repoId: string,
    prNumber: number,
    summary: string,
    event: 'COMMENT' | 'REQUEST_CHANGES' = 'COMMENT',
  ): Promise<any> {
    const repo = await this.prisma.repository.findUniqueOrThrow({
      where: { id: repoId },
    });
    const octokit = await this.getOctokitForRepo(repoId);

    return octokit.pulls.createReview({
      owner: repo.ownerLogin,
      repo: repo.name,
      pull_number: prNumber,
      event,
      body: summary,
    });
  }

  async mergePullRequest(
    repoId: string,
    prNumber: number,
    method: 'merge' | 'squash' | 'rebase' = 'merge',
    commitTitle?: string,
  ): Promise<{ merged: boolean; message: string }> {
    const repo = await this.prisma.repository.findUniqueOrThrow({ where: { id: repoId } });
    const octokit = await this.getOctokitForRepo(repoId);

    const { data } = await octokit.pulls.merge({
      owner: repo.ownerLogin,
      repo: repo.name,
      pull_number: prNumber,
      merge_method: method,
      commit_title: commitTitle,
    });
    return { merged: data.merged, message: data.message };
  }

  async updatePullRequestState(
    repoId: string,
    prNumber: number,
    state: 'open' | 'closed',
  ): Promise<void> {
    const repo = await this.prisma.repository.findUniqueOrThrow({ where: { id: repoId } });
    const octokit = await this.getOctokitForRepo(repoId);

    await octokit.pulls.update({
      owner: repo.ownerLogin,
      repo: repo.name,
      pull_number: prNumber,
      state,
    });
  }

  async getPRConversation(repoId: string, prNumber: number): Promise<any[]> {
    const repo = await this.prisma.repository.findUniqueOrThrow({ where: { id: repoId } });
    const octokit = await this.getOctokitForRepo(repoId);

    const { data } = await octokit.issues.listComments({
      owner: repo.ownerLogin,
      repo: repo.name,
      issue_number: prNumber,
      per_page: 100,
    });

    return data.map((c) => ({
      id: c.id,
      body: c.body ?? '',
      authorLogin: c.user?.login ?? 'unknown',
      authorAvatar: c.user?.avatar_url ?? null,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
      htmlUrl: c.html_url,
    }));
  }

  async getLineComments(repoId: string, prNumber: number): Promise<any[]> {
    const repo = await this.prisma.repository.findUniqueOrThrow({ where: { id: repoId } });
    const octokit = await this.getOctokitForRepo(repoId);

    const { data } = await octokit.pulls.listReviewComments({
      owner: repo.ownerLogin,
      repo: repo.name,
      pull_number: prNumber,
      per_page: 100,
    });

    return data.map((c) => ({
      id: c.id,
      path: c.path,
      line: c.line ?? c.original_line ?? null,
      side: c.side ?? 'RIGHT',
      body: c.body,
      authorLogin: c.user?.login ?? 'unknown',
      authorAvatar: c.user?.avatar_url ?? null,
      createdAt: c.created_at,
      htmlUrl: c.html_url,
    }));
  }

  async addPRComment(repoId: string, prNumber: number, body: string): Promise<any> {
    const repo = await this.prisma.repository.findUniqueOrThrow({ where: { id: repoId } });
    const octokit = await this.getOctokitForRepo(repoId);

    const { data } = await octokit.issues.createComment({
      owner: repo.ownerLogin,
      repo: repo.name,
      issue_number: prNumber,
      body,
    });

    return {
      id: data.id,
      body: data.body ?? '',
      authorLogin: data.user?.login ?? 'unknown',
      authorAvatar: data.user?.avatar_url ?? null,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      htmlUrl: data.html_url,
    };
  }

  async listRepoPullRequests(repoId: string, state: 'open' | 'closed' | 'all' = 'open') {
    const repo = await this.prisma.repository.findUniqueOrThrow({ where: { id: repoId } });
    const octokit = await this.getOctokitForRepo(repoId);

    const { data } = await octokit.pulls.list({
      owner: repo.ownerLogin,
      repo: repo.name,
      state,
      per_page: 100,
      sort: 'updated',
      direction: 'desc',
    });

    return data.map((pr) => ({
      githubPrNumber: pr.number,
      title: pr.title,
      body: pr.body ?? null,
      state: (pr.merged_at ? 'MERGED' : pr.state.toUpperCase()) as 'OPEN' | 'CLOSED' | 'MERGED',
      htmlUrl: pr.html_url,
      authorLogin: pr.user?.login ?? 'unknown',
      authorAvatar: pr.user?.avatar_url ?? null,
      baseBranch: pr.base.ref,
      headBranch: pr.head.ref,
      headSha: pr.head.sha,
      githubCreatedAt: new Date(pr.created_at),
      githubUpdatedAt: new Date(pr.updated_at),
    }));
  }

  async registerWebhook(
    repoId: string,
    webhookUrl: string,
    secret: string,
  ): Promise<number> {
    const repo = await this.prisma.repository.findUniqueOrThrow({
      where: { id: repoId },
    });
    const octokit = await this.getOctokitForRepo(repoId);

    const { data } = await octokit.repos.createWebhook({
      owner: repo.ownerLogin,
      repo: repo.name,
      config: {
        url: webhookUrl,
        content_type: 'json',
        secret,
        insecure_ssl: '0',
      },
      events: ['pull_request', 'push'],
      active: true,
    });

    this.logger.log(`Webhook registered for repo ${repo.fullName}: id=${data.id}`);
    return data.id;
  }

  async removeWebhook(repoId: string, webhookId: number) {
    const repo = await this.prisma.repository.findUniqueOrThrow({
      where: { id: repoId },
    });
    const octokit = await this.getOctokitForRepo(repoId);

    await octokit.repos.deleteWebhook({
      owner: repo.ownerLogin,
      repo: repo.name,
      hook_id: webhookId,
    });
  }

  private async getFileContent(
    octokit: Octokit,
    owner: string,
    repo: string,
    path: string,
    ref: string,
  ): Promise<string | undefined> {
    try {
      const { data } = await octokit.repos.getContent({ owner, repo, path, ref });
      if ('content' in data && data.encoding === 'base64') {
        const content = Buffer.from(data.content, 'base64').toString('utf8');
        // Limit to 50KB to avoid token overflow
        return content.length > 51200 ? content.slice(0, 51200) + '\n// [truncated]' : content;
      }
    } catch {
      // File might not exist at this ref — safe to ignore
    }
    return undefined;
  }

  private isReviewableFile(filename: string): boolean {
    const ignoredPatterns = [
      /package-lock\.json$/,
      /yarn\.lock$/,
      /pnpm-lock\.yaml$/,
      /\.min\.(js|css)$/,
      /dist\//,
      /build\//,
      /\.snap$/,
      /\.png$|\.jpg$|\.jpeg$|\.gif$|\.svg$|\.ico$/,
      /\.ttf$|\.woff$|\.eot$/,
    ];
    return !ignoredPatterns.some((p) => p.test(filename));
  }

  private detectLanguage(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    const languageMap: Record<string, string> = {
      ts: 'TypeScript', tsx: 'TypeScript',
      js: 'JavaScript', jsx: 'JavaScript',
      py: 'Python',
      java: 'Java',
      go: 'Go',
      cs: 'C#',
      rs: 'Rust',
      rb: 'Ruby',
      php: 'PHP',
      swift: 'Swift',
      kt: 'Kotlin',
      cpp: 'C++', cc: 'C++', cxx: 'C++',
      c: 'C', h: 'C',
      sql: 'SQL',
      sh: 'Shell', bash: 'Shell',
      yaml: 'YAML', yml: 'YAML',
      json: 'JSON',
      md: 'Markdown',
      tf: 'Terraform',
      dockerfile: 'Dockerfile',
    };
    return languageMap[ext] ?? 'Unknown';
  }
}
