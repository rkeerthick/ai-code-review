import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { createHash } from 'crypto';

export interface EmbeddingDocument {
  id: string;
  content: string;
  metadata: {
    repoId: string;
    orgId: string;
    filename: string;
    language: string;
    chunkIndex: number;
  };
}

const EMBEDDING_MODEL = 'text-embedding-3-large';
const EMBEDDING_DIMENSIONS = 3072;
const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 50;

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly openai: OpenAI;

  constructor(config: ConfigService) {
    this.openai = new OpenAI({ apiKey: config.getOrThrow('OPENAI_API_KEY') });
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const response = await this.openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text.slice(0, 8000), // API limit
      dimensions: EMBEDDING_DIMENSIONS,
    });
    return response.data[0].embedding;
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    // Batch in groups of 100 (API limit)
    const batches: string[][] = [];
    for (let i = 0; i < texts.length; i += 100) {
      batches.push(texts.slice(i, i + 100));
    }

    const allEmbeddings: number[][] = [];
    for (const batch of batches) {
      const response = await this.openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: batch.map((t) => t.slice(0, 8000)),
        dimensions: EMBEDDING_DIMENSIONS,
      });
      allEmbeddings.push(...response.data.map((d) => d.embedding));
    }

    return allEmbeddings;
  }

  chunkCode(
    content: string,
    filename: string,
    repoId: string,
    orgId: string,
    language: string,
  ): EmbeddingDocument[] {
    const words = content.split(/\s+/);
    const chunks: EmbeddingDocument[] = [];
    let chunkIndex = 0;

    for (let i = 0; i < words.length; i += CHUNK_SIZE - CHUNK_OVERLAP) {
      const chunkWords = words.slice(i, i + CHUNK_SIZE);
      const chunkText = chunkWords.join(' ');

      if (chunkText.trim().length < 50) continue; // Skip tiny chunks

      const id = createHash('sha256')
        .update(`${repoId}:${filename}:${chunkIndex}`)
        .digest('hex')
        .slice(0, 32);

      chunks.push({
        id,
        content: `// ${filename}\n${chunkText}`,
        metadata: { repoId, orgId, filename, language, chunkIndex },
      });

      chunkIndex++;
    }

    return chunks;
  }
}
