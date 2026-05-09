import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { ReviewChunk } from './diff-parser.service';
import { PromptBuilderService } from './prompt-builder.service';
import { ReviewSeverity, ReviewCategory } from '@prisma/client';

export interface ReviewComment {
  severity: ReviewSeverity;
  category: ReviewCategory;
  filePath: string;
  startLine: number;
  endLine: number;
  issue: string;
  suggestion: string;
  codeExample?: string;
  confidence: number;
}

export interface ReviewResult {
  comments: ReviewComment[];
  summary: string;
  qualityScore: number;
  tokensUsed: number;
  modelUsed: string;
}

@Injectable()
export class CodeAnalyzerService {
  private readonly logger = new Logger(CodeAnalyzerService.name);
  private readonly openai: OpenAI;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(
    private config: ConfigService,
    private promptBuilder: PromptBuilderService,
  ) {
    const baseURL = config.get<string>('OPENAI_BASE_URL');
    this.openai = new OpenAI({
      apiKey: config.getOrThrow('OPENAI_API_KEY'),
      ...(baseURL ? { baseURL } : {}),
    });
    this.model = config.get('OPENAI_MODEL', 'gpt-4.1');
    this.maxTokens = parseInt(config.get('OPENAI_MAX_TOKENS', '4096'));
  }

  async analyzeChunk(
    chunk: ReviewChunk,
    prTitle: string,
    ragContext?: string,
  ): Promise<ReviewResult> {
    const { systemMessage, userMessage, functionDefinition } =
      this.promptBuilder.buildReviewPrompt(chunk, prTitle, ragContext);

    this.logger.debug(
      `Analyzing chunk: ${chunk.filename} (${chunk.tokenEstimate} est. tokens)`,
    );

    const response = await this.openai.chat.completions.create({
      model: this.model,
      temperature: 0.1,
      max_tokens: this.maxTokens,
      messages: [
        { role: 'system', content: systemMessage },
        { role: 'user', content: userMessage },
      ],
      tools: [
        {
          type: 'function',
          function: functionDefinition as any,
        },
      ],
      tool_choice: { type: 'function', function: { name: 'submit_code_review' } },
    });

    const tokensUsed = response.usage?.total_tokens ?? 0;
    const toolCall = response.choices[0]?.message?.tool_calls?.[0];

    if (!toolCall?.function?.arguments) {
      this.logger.warn(`No tool call in response for ${chunk.filename}`);
      return { comments: [], summary: 'Review inconclusive', qualityScore: 50, tokensUsed, modelUsed: this.model };
    }

    let parsed: any;
    try {
      parsed = JSON.parse(toolCall.function.arguments);
    } catch {
      this.logger.error(`Failed to parse AI response for ${chunk.filename}`);
      return { comments: [], summary: 'Parse error', qualityScore: 50, tokensUsed, modelUsed: this.model };
    }

    const comments = (parsed.comments ?? [])
      .filter((c: any) => c.confidence >= 0.6) // Filter low-confidence comments
      .map((c: any): ReviewComment => ({
        severity: this.normalizeSeverity(c.severity),
        category: this.normalizeCategory(c.category),
        filePath: c.filePath ?? chunk.filename,
        startLine: Math.max(1, c.startLine ?? chunk.startLine),
        endLine: Math.max(1, c.endLine ?? c.startLine ?? chunk.startLine),
        issue: (c.issue ?? '').slice(0, 300),
        suggestion: (c.suggestion ?? '').slice(0, 600),
        codeExample: c.codeExample?.slice(0, 2000),
        confidence: Math.min(1, Math.max(0, c.confidence ?? 0.8)),
      }));

    return {
      comments,
      summary: (parsed.summary ?? '').slice(0, 300),
      qualityScore: Math.min(100, Math.max(0, parsed.qualityScore ?? 70)),
      tokensUsed,
      modelUsed: this.model,
    };
  }

  async analyzeMultipleChunks(
    chunks: ReviewChunk[],
    prTitle: string,
    ragContext?: string,
  ): Promise<ReviewResult> {
    // Process chunks concurrently with a limit of 3 parallel requests
    const results = await this.processWithConcurrencyLimit(chunks, 3, (chunk) =>
      this.analyzeChunk(chunk, prTitle, ragContext),
    );

    const allComments = results.flatMap((r) => r.comments);
    const totalTokens = results.reduce((sum, r) => sum + r.tokensUsed, 0);
    const avgScore = results.length > 0
      ? Math.round(results.reduce((sum, r) => sum + r.qualityScore, 0) / results.length)
      : 70;

    const criticalCount = allComments.filter((c) => c.severity === 'CRITICAL').length;
    const highCount = allComments.filter((c) => c.severity === 'HIGH').length;

    const summary = this.buildOverallSummary(allComments.length, criticalCount, highCount, avgScore);

    return {
      comments: allComments,
      summary,
      qualityScore: avgScore,
      tokensUsed: totalTokens,
      modelUsed: this.model,
    };
  }

  private buildOverallSummary(total: number, critical: number, high: number, score: number): string {
    if (total === 0) return 'Code looks clean! No significant issues found.';
    const parts: string[] = [];
    if (critical > 0) parts.push(`${critical} critical issue${critical > 1 ? 's' : ''}`);
    if (high > 0) parts.push(`${high} high-priority issue${high > 1 ? 's' : ''}`);
    return `Found ${total} issue${total > 1 ? 's' : ''} (${parts.join(', ') || 'minor'}). Quality score: ${score}/100.`;
  }

  private normalizeSeverity(s: string): ReviewSeverity {
    const map: Record<string, ReviewSeverity> = {
      CRITICAL: 'CRITICAL', HIGH: 'HIGH', MEDIUM: 'MEDIUM', LOW: 'LOW', INFO: 'INFO',
    };
    return map[s?.toUpperCase()] ?? 'MEDIUM';
  }

  private normalizeCategory(c: string): ReviewCategory {
    const map: Record<string, ReviewCategory> = {
      BUG: 'BUG', SECURITY: 'SECURITY', PERFORMANCE: 'PERFORMANCE',
      QUALITY: 'QUALITY', BEST_PRACTICE: 'BEST_PRACTICE', TESTING: 'TESTING',
      DOCUMENTATION: 'DOCUMENTATION', REFACTORING: 'REFACTORING',
      SCALABILITY: 'SCALABILITY', ACCESSIBILITY: 'ACCESSIBILITY',
    };
    return map[c?.toUpperCase()] ?? 'QUALITY';
  }

  private async processWithConcurrencyLimit<T, R>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<R>,
  ): Promise<R[]> {
    const results: R[] = [];
    for (let i = 0; i < items.length; i += limit) {
      const batch = items.slice(i, i + limit);
      const batchResults = await Promise.all(batch.map(fn));
      results.push(...batchResults);
    }
    return results;
  }
}
