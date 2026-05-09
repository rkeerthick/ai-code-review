import { Injectable } from '@nestjs/common';
import parseDiff from 'parse-diff';
import { DiffFile } from '../../github/github.service';

export interface ParsedHunk {
  header: string;
  oldStart: number;
  newStart: number;
  lines: ParsedLine[];
}

export interface ParsedLine {
  type: 'add' | 'del' | 'normal';
  content: string;
  lineNumber: number; // line number in new file
}

export interface ParsedFile {
  filename: string;
  language: string;
  status: string;
  additions: number;
  deletions: number;
  hunks: ParsedHunk[];
  rawContent?: string;
}

export interface ReviewChunk {
  filename: string;
  language: string;
  content: string;        // formatted for AI prompt
  startLine: number;
  endLine: number;
  tokenEstimate: number;
}

const TOKENS_PER_CHAR = 0.25; // rough estimate: 4 chars ≈ 1 token
const MAX_CHUNK_TOKENS = 3000;

@Injectable()
export class DiffParserService {
  parseDiff(files: DiffFile[]): ParsedFile[] {
    return files
      .filter((f) => f.patch || f.rawContent)
      .map((file) => this.parseFile(file));
  }

  splitIntoChunks(parsedFiles: ParsedFile[]): ReviewChunk[] {
    const chunks: ReviewChunk[] = [];

    for (const file of parsedFiles) {
      const fileChunks = this.chunkFile(file);
      chunks.push(...fileChunks);
    }

    return chunks;
  }

  private parseFile(file: DiffFile): ParsedFile {
    const hunks: ParsedHunk[] = [];

    if (file.patch) {
      const parsed = parseDiff(`--- a/${file.filename}\n+++ b/${file.filename}\n${file.patch}`);
      const parsedFile = parsed[0];

      if (parsedFile) {
        for (const chunk of parsedFile.chunks) {
          const hunk: ParsedHunk = {
            header: `@@ -${chunk.oldStart},${chunk.oldLines} +${chunk.newStart},${chunk.newLines} @@`,
            oldStart: chunk.oldStart,
            newStart: chunk.newStart,
            lines: [],
          };

          let lineNum = chunk.newStart;
          for (const change of chunk.changes) {
            if (change.type === 'add') {
              hunk.lines.push({ type: 'add', content: change.content, lineNumber: lineNum++ });
            } else if (change.type === 'del') {
              hunk.lines.push({ type: 'del', content: change.content, lineNumber: lineNum });
            } else {
              hunk.lines.push({ type: 'normal', content: change.content, lineNumber: lineNum++ });
            }
          }
          hunks.push(hunk);
        }
      }
    }

    return {
      filename: file.filename,
      language: file.language,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      hunks,
      rawContent: file.rawContent,
    };
  }

  private chunkFile(file: ParsedFile): ReviewChunk[] {
    const chunks: ReviewChunk[] = [];

    // Build formatted diff content
    const diffContent = this.formatDiffForAI(file);
    const tokenEstimate = Math.ceil(diffContent.length * TOKENS_PER_CHAR);

    if (tokenEstimate <= MAX_CHUNK_TOKENS) {
      // Small file — single chunk
      chunks.push({
        filename: file.filename,
        language: file.language,
        content: diffContent,
        startLine: file.hunks[0]?.newStart ?? 1,
        endLine: this.getLastLine(file),
        tokenEstimate,
      });
    } else {
      // Large file — split by hunks
      let currentContent = `File: ${file.filename} (${file.language})\n`;
      let currentTokens = 20;
      let chunkStart = file.hunks[0]?.newStart ?? 1;
      let chunkEnd = chunkStart;

      for (const hunk of file.hunks) {
        const hunkText = this.formatHunkForAI(hunk);
        const hunkTokens = Math.ceil(hunkText.length * TOKENS_PER_CHAR);

        if (currentTokens + hunkTokens > MAX_CHUNK_TOKENS && currentContent.length > 100) {
          chunks.push({
            filename: file.filename,
            language: file.language,
            content: currentContent,
            startLine: chunkStart,
            endLine: chunkEnd,
            tokenEstimate: currentTokens,
          });
          currentContent = `File: ${file.filename} (${file.language})\n`;
          currentTokens = 20;
          chunkStart = hunk.newStart;
        }

        currentContent += hunkText;
        currentTokens += hunkTokens;
        chunkEnd = hunk.newStart + hunk.lines.length;
      }

      if (currentContent.length > 100) {
        chunks.push({
          filename: file.filename,
          language: file.language,
          content: currentContent,
          startLine: chunkStart,
          endLine: chunkEnd,
          tokenEstimate: currentTokens,
        });
      }
    }

    return chunks;
  }

  private formatDiffForAI(file: ParsedFile): string {
    const lines: string[] = [
      `File: ${file.filename} (${file.language}) [${file.status}]`,
      `Changes: +${file.additions} -${file.deletions}`,
      '',
    ];

    if (file.rawContent) {
      lines.push('=== Full File Content ===');
      lines.push(file.rawContent);
      lines.push('');
      lines.push('=== Changes (diff) ===');
    }

    for (const hunk of file.hunks) {
      lines.push(this.formatHunkForAI(hunk));
    }

    return lines.join('\n');
  }

  private formatHunkForAI(hunk: ParsedHunk): string {
    const lines: string[] = [hunk.header, ''];
    for (const line of hunk.lines) {
      const prefix = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';
      lines.push(`${prefix}${String(line.lineNumber).padStart(4)} ${line.content}`);
    }
    lines.push('');
    return lines.join('\n');
  }

  private getLastLine(file: ParsedFile): number {
    if (file.hunks.length === 0) return 1;
    const last = file.hunks[file.hunks.length - 1];
    return last.newStart + last.lines.length;
  }
}
