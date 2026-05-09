import { Injectable } from '@nestjs/common';
import { ReviewChunk } from './diff-parser.service';

export interface ReviewPrompt {
  systemMessage: string;
  userMessage: string;
  functionDefinition: object;
}

@Injectable()
export class PromptBuilderService {
  buildReviewPrompt(
    chunk: ReviewChunk,
    prTitle: string,
    ragContext?: string,
  ): ReviewPrompt {
    const systemMessage = this.buildSystemMessage();
    const userMessage = this.buildUserMessage(chunk, prTitle, ragContext);
    const functionDefinition = this.buildFunctionDefinition();

    return { systemMessage, userMessage, functionDefinition };
  }

  private buildSystemMessage(): string {
    return `You are an expert senior software engineer, security specialist, and code quality expert with 15+ years of experience. You review code with the rigor of a principal engineer at a top-tier tech company (Google, Amazon, Meta).

Your reviews are:
- **Actionable**: Every comment includes a specific, concrete suggestion
- **Educational**: Briefly explain WHY something is a problem, not just WHAT
- **Prioritized**: Focus on real issues — avoid nitpicking style preferences
- **Security-minded**: Always check for vulnerabilities, even in non-security code
- **Precise**: Reference exact line numbers and variable names

Review categories you must check:
1. **SECURITY**: SQL injection, XSS, auth bypass, secrets exposure, insecure crypto, path traversal, race conditions, dependency vulnerabilities
2. **BUG**: Logic errors, null/undefined dereferences, off-by-one errors, async/await misuse, error handling gaps, type coercion issues
3. **PERFORMANCE**: N+1 queries, missing indexes (inferred), memory leaks, sync blocking operations, inefficient algorithms, excessive re-renders
4. **QUALITY**: Overly complex code, poor naming, magic numbers/strings, code duplication, inconsistent patterns
5. **BEST_PRACTICE**: Missing input validation, improper resource cleanup, missing error boundaries, anti-patterns for the detected language
6. **TESTING**: Untested critical paths, missing edge cases, hard-to-test code structures
7. **DOCUMENTATION**: Missing JSDoc/docstrings for public APIs, confusing function signatures
8. **REFACTORING**: Extract method opportunities, SOLID principle violations, God objects
9. **SCALABILITY**: Code that won't scale, blocking I/O in hot paths, missing pagination
10. **ACCESSIBILITY**: ARIA issues, missing alt text, keyboard navigation (for frontend code)

Return ONLY valid JSON. No markdown, no explanation outside the function call.`;
  }

  private buildUserMessage(
    chunk: ReviewChunk,
    prTitle: string,
    ragContext?: string,
  ): string {
    const lines: string[] = [
      `## Pull Request: "${prTitle}"`,
      '',
      '## Code to Review:',
      '```',
      chunk.content,
      '```',
    ];

    if (ragContext) {
      lines.push('');
      lines.push('## Repository Context (similar patterns in codebase):');
      lines.push(ragContext);
    }

    lines.push('');
    lines.push(
      'Review the above code changes. Find real issues only — do not report style preferences or obvious good code as problems. If the code is clean with no issues, return an empty comments array.',
    );

    return lines.join('\n');
  }

  private buildFunctionDefinition(): object {
    return {
      name: 'submit_code_review',
      description: 'Submit structured code review comments for the provided diff',
      parameters: {
        type: 'object',
        properties: {
          summary: {
            type: 'string',
            description: '1-2 sentence overall assessment of the code quality (max 300 chars)',
          },
          qualityScore: {
            type: 'integer',
            minimum: 0,
            maximum: 100,
            description: 'Overall code quality score 0-100 (100 = perfect, 0 = critical issues)',
          },
          comments: {
            type: 'array',
            items: {
              type: 'object',
              required: ['severity', 'category', 'filePath', 'startLine', 'issue', 'suggestion', 'confidence'],
              properties: {
                severity: {
                  type: 'string',
                  enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'],
                  description: 'CRITICAL=security/data-loss, HIGH=definite bug, MEDIUM=likely issue, LOW=improvement, INFO=note',
                },
                category: {
                  type: 'string',
                  enum: ['BUG', 'SECURITY', 'PERFORMANCE', 'QUALITY', 'BEST_PRACTICE', 'TESTING', 'DOCUMENTATION', 'REFACTORING', 'SCALABILITY', 'ACCESSIBILITY'],
                },
                filePath: { type: 'string', description: 'File path from the diff' },
                startLine: { type: 'integer', description: 'Starting line number in the NEW file' },
                endLine: { type: 'integer', description: 'Ending line number (same as startLine for single-line issues)' },
                issue: {
                  type: 'string',
                  maxLength: 300,
                  description: 'Clear description of the problem — include WHY it is a problem',
                },
                suggestion: {
                  type: 'string',
                  maxLength: 600,
                  description: 'Concrete suggestion for how to fix the issue',
                },
                codeExample: {
                  type: 'string',
                  description: 'Optional corrected code snippet (max 20 lines)',
                },
                confidence: {
                  type: 'number',
                  minimum: 0,
                  maximum: 1,
                  description: 'Confidence 0-1 that this is actually a problem',
                },
              },
            },
          },
        },
        required: ['summary', 'qualityScore', 'comments'],
      },
    };
  }
}
