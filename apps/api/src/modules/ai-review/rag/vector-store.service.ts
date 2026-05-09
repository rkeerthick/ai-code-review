import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pinecone } from '@pinecone-database/pinecone';
import { EmbeddingService, EmbeddingDocument } from './embedding.service';

export interface SearchResult {
  filename: string;
  content: string;
  score: number;
  language: string;
}

@Injectable()
export class VectorStoreService {
  private readonly logger = new Logger(VectorStoreService.name);
  private readonly pinecone: Pinecone;
  private readonly indexName: string;
  private readonly isEnabled: boolean;

  constructor(
    private config: ConfigService,
    private embeddings: EmbeddingService,
  ) {
    this.isEnabled = config.get('ENABLE_VECTOR_SEARCH', 'true') === 'true';
    this.indexName = config.get('PINECONE_INDEX', 'code-embeddings');

    if (this.isEnabled) {
      this.pinecone = new Pinecone({
        apiKey: config.getOrThrow('PINECONE_API_KEY'),
      });
    }
  }

  async upsertDocuments(documents: EmbeddingDocument[]): Promise<void> {
    if (!this.isEnabled || documents.length === 0) return;

    try {
      const texts = documents.map((d) => d.content);
      const vectors = await this.embeddings.generateEmbeddings(texts);

      const index = this.pinecone.index(this.indexName);

      // Use organization namespace for tenant isolation
      const namespace = documents[0].metadata.orgId;
      const ns = index.namespace(namespace);

      const records = documents.map((doc, i) => ({
        id: doc.id,
        values: vectors[i],
        metadata: {
          ...doc.metadata,
          content: doc.content.slice(0, 1000), // Pinecone metadata limit
        },
      }));

      // Batch upserts in groups of 100
      for (let i = 0; i < records.length; i += 100) {
        await ns.upsert(records.slice(i, i + 100));
      }

      this.logger.debug(`Upserted ${documents.length} vectors for org ${namespace}`);
    } catch (err) {
      this.logger.error('Vector store upsert failed', err);
    }
  }

  async searchSimilar(
    query: string,
    orgId: string,
    topK = 5,
  ): Promise<SearchResult[]> {
    if (!this.isEnabled) return [];

    try {
      const queryVector = await this.embeddings.generateEmbedding(query);
      const index = this.pinecone.index(this.indexName);
      const ns = index.namespace(orgId);

      const results = await ns.query({
        vector: queryVector,
        topK,
        includeMetadata: true,
        includeValues: false,
      });

      return (results.matches ?? [])
        .filter((m) => m.score && m.score > 0.75) // Relevance threshold
        .map((m) => ({
          filename: m.metadata?.filename as string ?? '',
          content: m.metadata?.content as string ?? '',
          score: m.score ?? 0,
          language: m.metadata?.language as string ?? '',
        }));
    } catch (err) {
      this.logger.error('Vector search failed', err);
      return [];
    }
  }

  async deleteRepositoryVectors(repoId: string, orgId: string): Promise<void> {
    if (!this.isEnabled) return;

    try {
      const index = this.pinecone.index(this.indexName);
      const ns = index.namespace(orgId);

      // Delete by metadata filter
      await ns.deleteMany({ repoId });
      this.logger.log(`Deleted vectors for repo ${repoId}`);
    } catch (err) {
      this.logger.error('Vector deletion failed', err);
    }
  }

  formatContextForPrompt(results: SearchResult[]): string {
    if (results.length === 0) return '';

    const lines = ['Similar patterns found in this codebase:'];
    for (const r of results) {
      lines.push(`\n// From: ${r.filename} (similarity: ${(r.score * 100).toFixed(0)}%)`);
      lines.push(r.content.slice(0, 500));
    }
    return lines.join('\n');
  }
}
