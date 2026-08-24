const crypto = require('crypto');
const {
  qdrantApiKey,
  qdrantCollection,
  qdrantEnabled,
  qdrantUrl
} = require('../config/env');
const { generateEmbeddingWithOllama } = require('./ollamaService');

const MAX_CHUNK_CHARS = 1200;
const CHUNK_OVERLAP_CHARS = 180;

function isQdrantEnabled() {
  return qdrantEnabled && Boolean(qdrantUrl);
}

function buildQdrantUrl(pathname) {
  return new URL(pathname, qdrantUrl).toString();
}

function getQdrantHeaders() {
  return {
    'Content-Type': 'application/json',
    ...(qdrantApiKey ? { 'api-key': qdrantApiKey } : {})
  };
}

function normalizeChunkText(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function chunkText(content) {
  const text = normalizeChunkText(content);

  if (!text) {
    return [];
  }

  const paragraphs = text.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
  const chunks = [];
  let current = '';

  function pushCurrent() {
    const cleaned = normalizeChunkText(current);

    if (cleaned.length >= 40) {
      chunks.push(cleaned);
    }

    current = '';
  }

  for (const paragraph of paragraphs) {
    if ((current + '\n\n' + paragraph).trim().length <= MAX_CHUNK_CHARS) {
      current = [current, paragraph].filter(Boolean).join('\n\n');
      continue;
    }

    pushCurrent();

    if (paragraph.length <= MAX_CHUNK_CHARS) {
      current = paragraph;
      continue;
    }

    for (let index = 0; index < paragraph.length; index += MAX_CHUNK_CHARS - CHUNK_OVERLAP_CHARS) {
      chunks.push(paragraph.slice(index, index + MAX_CHUNK_CHARS).trim());
    }
  }

  pushCurrent();
  return chunks;
}

function buildPointId(documentId, pageNumber, chunkIndex) {
  return crypto
    .createHash('md5')
    .update(`${documentId}:${pageNumber}:${chunkIndex}`)
    .digest('hex');
}

async function qdrantFetch(pathname, options = {}) {
  const response = await fetch(buildQdrantUrl(pathname), {
    ...options,
    headers: {
      ...getQdrantHeaders(),
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Qdrant ${response.status}: ${text || response.statusText}`);
  }

  return response.json().catch(() => ({}));
}

async function ensureCollection(vectorSize) {
  if (!isQdrantEnabled()) {
    return false;
  }

  const collectionPath = `/collections/${encodeURIComponent(qdrantCollection)}`;

  try {
    await qdrantFetch(collectionPath);
    return true;
  } catch {
    await qdrantFetch(collectionPath, {
      method: 'PUT',
      body: JSON.stringify({
        vectors: {
          size: vectorSize,
          distance: 'Cosine'
        }
      })
    });
    return true;
  }
}

async function upsertPoints(points) {
  if (!points.length || !isQdrantEnabled()) {
    return false;
  }

  await qdrantFetch(`/collections/${encodeURIComponent(qdrantCollection)}/points?wait=true`, {
    method: 'PUT',
    body: JSON.stringify({ points })
  });

  return true;
}

async function deleteDocumentVectors(documentId) {
  if (!isQdrantEnabled() || !documentId) {
    return false;
  }

  try {
    await qdrantFetch(`/collections/${encodeURIComponent(qdrantCollection)}/points/delete?wait=true`, {
      method: 'POST',
      body: JSON.stringify({
        filter: {
          must: [
            {
              key: 'documentId',
              match: { value: Number(documentId) }
            }
          ]
        }
      })
    });
    return true;
  } catch (error) {
    if (!/Collection .*doesn't exist|Not found/i.test(error.message)) {
      console.warn(`Qdrant document vector delete failed: ${error.message}`);
    }
    return false;
  }
}

async function indexDocumentPages({ documentId, title, siteScope, accessLevel = 'external', pages }) {
  if (!isQdrantEnabled()) {
    return { indexed: 0, enabled: false };
  }

  const points = [];

  for (const page of pages || []) {
    const chunks = chunkText(page.content);

    for (const [chunkIndex, chunk] of chunks.entries()) {
      const embedding = await generateEmbeddingWithOllama([
        title,
        `Page ${page.pageNumber}`,
        chunk
      ].filter(Boolean).join('\n\n'));

      if (!embedding) {
        continue;
      }

      if (points.length === 0) {
        await ensureCollection(embedding.length);
      }

      points.push({
        id: buildPointId(documentId, page.pageNumber, chunkIndex),
        vector: embedding,
        payload: {
          documentId: Number(documentId),
          title,
          siteScope,
          accessLevel,
          pageNumber: Number(page.pageNumber),
          chunkIndex,
          content: chunk
        }
      });
    }
  }

  await upsertPoints(points);

  return {
    enabled: true,
    indexed: points.length
  };
}

async function searchSemanticDocuments(question, { scope = 'general', includeInternal = false, limit = 12 } = {}) {
  if (!isQdrantEnabled()) {
    return [];
  }

  const embedding = await generateEmbeddingWithOllama(question);

  if (!embedding) {
    return [];
  }

  try {
    await ensureCollection(embedding.length);

    const data = await qdrantFetch(`/collections/${encodeURIComponent(qdrantCollection)}/points/search`, {
      method: 'POST',
      body: JSON.stringify({
        vector: embedding,
        limit,
        with_payload: true,
        score_threshold: 0.45,
        filter: {
          must: [
            {
              key: 'siteScope',
              match: { value: scope }
            },
            ...(includeInternal ? [] : [{
              key: 'accessLevel',
              match: { value: 'external' }
            }])
          ]
        }
      })
    });

    return (data.result || [])
      .map((point) => ({
        document_id: point.payload?.documentId,
        page_number: point.payload?.pageNumber,
        content: point.payload?.content,
        title: point.payload?.title,
        semanticScore: point.score
      }))
      .filter((match) => match.document_id && match.page_number && match.content);
  } catch (error) {
    console.warn(`Qdrant semantic search failed: ${error.message}`);
    return [];
  }
}

module.exports = {
  deleteDocumentVectors,
  indexDocumentPages,
  isQdrantEnabled,
  searchSemanticDocuments
};
