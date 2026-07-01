const pool = require('../utils/db');
const { toPublicPath } = require('./fileService');
const {
  generateGeneralAnswerWithOllama,
  generateOfficialTextSummaryWithOllama
} = require('./ollamaService');

function getSearchTerms(question) {
  const stopWords = new Set([
    'what',
    'the',
    'and',
    'for',
    'this',
    'that',
    'with',
    'about',
    'mean',
    'means',
    'good',
    'using',
    'use',
    'used',
    'user',
    'users',
    'give',
    'tell',
    'please',
    'can',
    'could',
    'would',
    'should',
    'how',
    'why',
    'who',
    'where',
    'when'
  ]);

  return question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((term) => term.length > 2 && !stopWords.has(term));
}

function normalizeText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function getExactSearchPhrase(question) {
  return String(question || '')
    .toLowerCase()
    .replace(/\b(do|does|did|you|have|has|with|image|images|picture|pictures|photo|photos|screenshot|screenshots|screen shot|source page|document preview|page preview)\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(what|where|when|who|why|how|can|could|please|tell|show|give|explain|describe)\b\s*/i, '')
    .replace(/^(is|are|about|the|a|an|me|to|for|of)\b\s*/i, '')
    .replace(/^(is|are|about|the|a|an|me|to|for|of)\b\s*/i, '')
    .trim();
}

function getPrintedPageNumber(content) {
  const match = String(content || '').match(/Page\s*\|\s*(\d+)/i);
  return match ? Number(match[1]) : null;
}

function addPageMetadata(match) {
  const printedPageNumber = getPrintedPageNumber(match.content);

  return {
    ...match,
    printedPageNumber,
    pageLabel: printedPageNumber ? String(printedPageNumber) : String(match.page_number)
  };
}

function isLikelyTableOfContents(match) {
  const lines = String(match.content || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const firstLines = lines.slice(0, 16).join(' ').toLowerCase();
  const dottedLineCount = lines.filter((line) => /\.{5,}/.test(line)).length;
  const pageRangeLineCount = lines.filter((line) => /\b\d+\s*-\s*\d+\s*$/.test(line)).length;

  return firstLines.includes('contents') || dottedLineCount >= 3 || pageRangeLineCount >= 3;
}

function getTableOfContentsPageRefs(match, normalizedQuestion) {
  if (!isLikelyTableOfContents(match)) {
    return [];
  }

  return String(match.content || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => normalizeText(line).includes(normalizedQuestion))
    .flatMap((line) => {
      const pageMatch = line.replace(/\.{2,}/g, ' ').match(/(\d+)(?:\s*-\s*(\d+))?\s*$/);

      if (!pageMatch) {
        return [];
      }

      const startPage = Number(pageMatch[1]);
      const endPage = Number(pageMatch[2] || pageMatch[1]);
      const pageRefs = [];

      for (let page = startPage; page <= endPage && pageRefs.length < 4; page += 1) {
        pageRefs.push({
          documentId: match.document_id,
          printedPageNumber: page
        });
      }

      return pageRefs;
    });
}

async function findMatchesByPrintedPageRefs(pageRefs) {
  if (pageRefs.length === 0) {
    return [];
  }

  const conditions = pageRefs
    .map(() => '(dt.document_id = ? AND dt.content REGEXP ?)')
    .join(' OR ');
  const params = pageRefs.flatMap((pageRef) => [
    pageRef.documentId,
    `Page[[:space:]]*[|][[:space:]]*${pageRef.printedPageNumber}([^0-9]|$)`
  ]);
  const [rows] = await pool.execute(
    `SELECT dt.document_id, dt.page_number, dt.content, d.title
     FROM document_text dt
     JOIN documents d ON d.id = dt.document_id
     WHERE ${conditions}`,
    params
  );

  return rows.map(addPageMetadata);
}

function scoreMatch(match, terms) {
  const content = match.content.toLowerCase();
  const firstLines = content.split('\n').slice(0, 8).join(' ');
  const termHits = terms.filter((term) => content.includes(term)).length;
  const headingHits = terms.filter((term) => firstLines.includes(term)).length;
  const tocPenalty = /contents|\.{5,}| \d+-\d+/.test(firstLines) ? 5 : 0;

  return (headingHits * 5) + termHits - tocPenalty;
}

function getTermCoverage(match, terms) {
  const searchableText = normalizeText(`${match.title || ''} ${match.content || ''}`);

  return terms.filter((term) => searchableText.includes(term)).length;
}

function hasEnoughTermCoverage(match, terms) {
  if (terms.length === 0) {
    return false;
  }

  if (terms.length <= 1) {
    return getTermCoverage(match, terms) >= terms.length;
  }

  return getTermCoverage(match, terms) >= Math.min(2, terms.length);
}

function buildNoOfficialMatchAnswer() {
  return {
    answer: 'I could not find an official uploaded document that answers this question. Please rephrase your question or contact the appropriate university office for confirmation.',
    answerBlocks: [
      {
        type: 'p',
        text: 'I could not find an official uploaded document that answers this question. Please rephrase your question or contact the appropriate university office for confirmation.'
      }
    ],
    answerMode: 'no_official_document_match',
    images: [],
    sources: []
  };
}

async function buildNoMatchAnswer({ question }) {
  const generalAnswer = await generateGeneralAnswerWithOllama({ question });

  if (!generalAnswer) {
    return buildNoOfficialMatchAnswer();
  }

  const answer = [
    'I could not find this in the uploaded official university documents, but here is a general MCU answer:',
    '',
    generalAnswer
  ].join('\n');

  return {
    answer,
    answerBlocks: [
      {
        type: 'p',
        text: 'I could not find this in the uploaded official university documents, but here is a general MCU answer:'
      },
      {
        type: 'p',
        text: generalAnswer
      }
    ],
    answerMode: 'general_ai',
    images: [],
    sources: []
  };
}

function buildExtractiveAnswer(matches) {
  return matches
    .map((match) => `${match.title}, page ${match.page_number}: ${match.content.slice(0, 700)}`)
    .join('\n\n');
}

function cleanOfficialLine(line) {
  return line.replace(/\s+/g, ' ').trim();
}

function splitFlattenedStepLine(line) {
  return line
    .replace(/\s+(Step\s+\d+:)/gi, '\n$1')
    .split('\n')
    .map((part) => part.trim())
    .filter(Boolean);
}

function splitFlattenedNumberedLine(line) {
  return line
    .replace(/\s+(\d+\.\s+)/g, '\n$1')
    .split('\n')
    .map((part) => part.trim())
    .filter(Boolean);
}

function isTableOfContentsLine(line) {
  return /\.{5,}/.test(line) || /\b\d+\s*-\s*\d+\s*$/.test(line);
}

function isDisplayableOfficialLine(line) {
  return !/^Page\s*\|\s*\d+$/i.test(line) && !isTableOfContentsLine(line);
}

function isTableFieldHeading(line) {
  return /^(steps and modules|activities|erp users|users|modules):?$/i.test(line);
}

function isOfficialHeading(line) {
  return (
    isNoteHeading(line) ||
    isTableFieldHeading(line) ||
    /^Step\s+\d+:/i.test(line) ||
    /^[A-Z][A-Z0-9\s|&/():-]{2,}$/.test(line) ||
    /^GLNet On Line Help$/i.test(line) ||
    /^Steps using /i.test(line)
  );
}

function mergeWrappedOfficialLines(lines) {
  const mergedLines = [];

  lines.forEach((line) => {
    const previousLine = mergedLines[mergedLines.length - 1];
    const startsNewInstruction = /^(visit|login|log in|from\b|in\b|on\b|read\b|pay\b|choose\b|click\b|type\b|fill\b|select\b|enter\b|submit\b|go\b|you may\b|to add\b|to view\b|to search\b|to go\b)/i.test(line);
    const shouldMergeWithPrevious = previousLine &&
      !isOfficialHeading(previousLine) &&
      !isOfficialHeading(line) &&
      !/^\d+\.\s+/.test(line) &&
      !/[.!?:;]$/.test(previousLine) &&
      (/^[a-z]/.test(line) || !startsNewInstruction);

    if (shouldMergeWithPrevious) {
      mergedLines[mergedLines.length - 1] = `${previousLine} ${line}`;
      return;
    }

    mergedLines.push(line);
  });

  return mergedLines;
}

function isNoteHeading(line) {
  return /^notes?:?$/i.test(line);
}

function isInstructionLine(line) {
  return /^(visit|login|log in|from\b|in\b|on\b|read\b|pay\b|choose\b|click\b|type\b|fill\b|select\b|enter\b|submit\b|go\b|you may\b)/i.test(line);
}

function formatProcedureBlocks(blocks) {
  const instructionCount = blocks.filter((block) => block.type === 'paragraph' && isInstructionLine(block.text)).length;

  if (instructionCount < 3) {
    return blocks;
  }

  const formattedBlocks = [];
  let currentList = null;
  let listIsOpen = false;

  function flushList() {
    if (currentList?.items.length) {
      formattedBlocks.push(currentList);
    }

    currentList = null;
  }

  blocks.forEach((block) => {
    if (block.type === 'list') {
      flushList();
      formattedBlocks.push(block);
      return;
    }

    if (block.type === 'heading') {
      flushList();
      formattedBlocks.push({
        ...block,
        text: block.text.replace(/:$/, '')
      });
      listIsOpen = !isNoteHeading(block.text);
      return;
    }

    if (listIsOpen && block.type === 'paragraph') {
      currentList = currentList || {
        type: 'list',
        style: 'ordered',
        items: []
      };
      currentList.items.push(block.text);
      return;
    }

    flushList();
    formattedBlocks.push(block);
  });

  flushList();
  return formattedBlocks;
}

function buildOfficialTextAnswer(matches) {
  return matches
    .slice()
    .sort((a, b) => a.page_number - b.page_number)
    .map((match) => {
      const lines = String(match.content || '')
        .split(/\r?\n/)
        .map(cleanOfficialLine)
        .filter(Boolean)
        .filter(isDisplayableOfficialLine);

      return lines.join('\n');
    })
    .join('\n\n')
    .trim();
}

function buildOfficialTextBlocks(matches) {
  const blocks = [];
  let currentNumberedList = null;

  function flushNumberedList() {
    if (currentNumberedList?.items.length) {
      blocks.push(currentNumberedList);
    }

    currentNumberedList = null;
  }

  matches
    .slice()
    .sort((a, b) => a.page_number - b.page_number)
    .forEach((match) => {
      const lines = String(match.content || '')
        .split(/\r?\n/)
        .flatMap(splitFlattenedStepLine)
        .flatMap(splitFlattenedNumberedLine)
        .map(cleanOfficialLine)
        .filter(Boolean)
        .filter(isDisplayableOfficialLine)
        .map((line) => line.replace(/^(\d+)\.\s+/, '$1. '));

      mergeWrappedOfficialLines(lines).forEach((line) => {
        const numberedMatch = line.match(/^(\d+)\.\s+(.+)$/);

        if (numberedMatch) {
          currentNumberedList = currentNumberedList || {
            type: 'list',
            style: 'ordered',
            items: []
          };
          currentNumberedList.items.push({
            marker: numberedMatch[1],
            value: numberedMatch[2]
          });
          return;
        }

        flushNumberedList();

        const fieldMatch = line.match(/^(Steps and Modules|Activities|ERP Users|Users|Modules):\s*(.+)$/i);

        if (fieldMatch) {
          blocks.push({
            type: 'heading',
            text: fieldMatch[1]
          });
          blocks.push({
            type: 'paragraph',
            text: fieldMatch[2]
          });
          return;
        }

        blocks.push({
          type: isOfficialHeading(line) ? 'heading' : 'paragraph',
          text: line
        });
      });
    });

  flushNumberedList();

  return formatProcedureBlocks(blocks);
}

function blocksToText(blocks) {
  return blocks
    .map((block) => {
      if (block.type === 'list') {
        return block.items.map((item, index) => `${index + 1}. ${item}`).join('\n');
      }

      return block.text;
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

function getTopicCategory(document) {
  const text = `${document.title || ''} ${document.sample_content || ''}`.toLowerCase();

  if (/enroll|admission|applicant|entrance|requirement/.test(text)) {
    return 'Admissions';
  }

  if (/tuition|payment|fee|cashier|refund|check|voucher|finance|billing|market|disbursement/.test(text)) {
    return 'Finance';
  }

  if (/academic|subject|curriculum|calendar|grade|course|faculty|student section/.test(text)) {
    return 'Academics';
  }

  if (/library|map|housing|service|portal|account|support/.test(text)) {
    return 'Services';
  }

  if (/organization|student life|activity|campus/.test(text)) {
    return 'Student Life';
  }

  return 'Knowledge Base';
}

function getTopicIcon(title) {
  const firstAlphaNumeric = String(title || '?').match(/[a-z0-9$?]/i)?.[0] || '?';
  return firstAlphaNumeric.toUpperCase();
}

async function listKnowledgeTopics({ scope = 'general' } = {}) {
  const [documents] = await pool.execute(
    `SELECT MAX(d.id) AS id, d.title, MAX(d.created_at) AS created_at,
            SUBSTRING_INDEX(GROUP_CONCAT(dt.content ORDER BY d.created_at DESC, dt.page_number ASC SEPARATOR ' '), ' ', 120) AS sample_content
     FROM documents d
     LEFT JOIN document_text dt ON dt.document_id = d.id
     WHERE d.site_scope = ?
     GROUP BY d.title
     ORDER BY created_at DESC`,
    [scope]
  );
  const groups = new Map();

  documents.forEach((document) => {
    const category = getTopicCategory(document);
    const item = {
      id: document.id,
      icon: getTopicIcon(document.title),
      label: document.title,
      prompt: `Tell me about ${document.title}.`
    };

    if (!groups.has(category)) {
      groups.set(category, []);
    }

    groups.get(category).push(item);
  });

  return [...groups.entries()].map(([label, items]) => ({
    label,
    items
  }));
}

function buildHybridOfficialBlocks({ summary, officialBlocks }) {
  const blocks = [];

  if (summary) {
    blocks.push({
      type: 'paragraph',
      text: summary,
      variant: 'summary'
    });
  }

  if (officialBlocks.length > 0) {
    blocks.push(...officialBlocks);
  }

  return blocks;
}

function buildHybridOfficialAnswer({ summary, officialText }) {
  if (!summary) {
    return officialText;
  }

  return [summary, officialText].join('\n\n');
}

async function searchDocuments(question, { scope = 'general' } = {}) {
  const likeQuery = `%${question}%`;
  const terms = getSearchTerms(question);
  const normalizedQuestion = normalizeText(question);
  const exactSearchPhrase = getExactSearchPhrase(question);
  const exactLikeQuery = exactSearchPhrase.length > 2 ? `%${exactSearchPhrase}%` : likeQuery;

  if (terms.length === 0 && exactSearchPhrase.length < 3) {
    return {
      answer: 'Please ask a more specific question so I can search the uploaded university documents correctly.',
      answerBlocks: [
        {
          type: 'p',
          text: 'Please ask a more specific question so I can search the uploaded university documents correctly.'
        }
      ],
      answerMode: 'needs_more_detail',
      images: [],
      sources: []
    };
  }

  const [titleRows] = exactSearchPhrase.length > 2
    ? await pool.execute(
      `SELECT dt.document_id, dt.page_number, dt.content, d.title
       FROM document_text dt
       JOIN documents d ON d.id = dt.document_id
       WHERE d.site_scope = ?
         AND d.title LIKE ?
       ORDER BY dt.page_number ASC
       LIMIT 10`,
      [scope, exactLikeQuery]
    )
    : [[]];

  const [exactPhraseRows] = exactSearchPhrase.length > 2
    ? await pool.execute(
      `SELECT dt.document_id, dt.page_number, dt.content, d.title
       FROM document_text dt
       JOIN documents d ON d.id = dt.document_id
       WHERE d.site_scope = ?
         AND dt.content LIKE ?
       LIMIT 10`,
      [scope, exactLikeQuery]
    )
    : [[]];

  const [broadRows] = await pool.execute(
    `SELECT dt.document_id, dt.page_number, dt.content, d.title
     FROM document_text dt
     JOIN documents d ON d.id = dt.document_id
     WHERE d.site_scope = ?
       AND (
         MATCH(dt.content) AGAINST (? IN NATURAL LANGUAGE MODE)
         OR dt.content LIKE ?
       )
     LIMIT 25`,
    [scope, question, likeQuery]
  );
  const dedupedRows = new Map();
  [...titleRows, ...exactPhraseRows, ...broadRows].forEach((row) => {
    dedupedRows.set(`${row.document_id}:${row.page_number}`, row);
  });
  const matches = [...dedupedRows.values()];

  if (matches.length > 0) {
    const enrichedMatches = matches.map(addPageMetadata);
    const normalizedExactPhrase = exactSearchPhrase || normalizedQuestion;
    const exactMatches = enrichedMatches.filter(
      (match) => normalizeText(match.content).includes(normalizedExactPhrase) && !isLikelyTableOfContents(match)
    );
    const titleMatches = enrichedMatches.filter(
      (match) => normalizeText(match.title).includes(normalizedExactPhrase)
    );
    const tocPageRefs = enrichedMatches.flatMap((match) => getTableOfContentsPageRefs(match, normalizedExactPhrase));
    const tocPageMatches = exactMatches.length === 0 && titleMatches.length === 0
      ? await findMatchesByPrintedPageRefs(tocPageRefs)
      : [];
    const exactMatchKeys = new Set(
      [...exactMatches, ...titleMatches].map((match) => `${match.document_id}:${match.page_number}`)
    );
    const contentMatches = enrichedMatches.filter((match) => !isLikelyTableOfContents(match));
    let candidateMatches = titleMatches.length > 0
      ? titleMatches
      : tocPageMatches.length > 0
      ? tocPageMatches
      : contentMatches.length > 0 ? contentMatches : enrichedMatches;

    if (exactMatches.length > 0 && titleMatches.length === 0) {
      const exactSeedMatches = exactMatches.slice(0, 1);
      const exactPageConditions = exactSeedMatches
        .map(() => '(dt.document_id = ? AND dt.page_number BETWEEN ? AND ?)')
        .join(' OR ');
      const exactPageParams = exactSeedMatches.flatMap((match) => [
        match.document_id,
        match.page_number,
        match.page_number + 1
      ]);
      const [nearbyMatches] = await pool.execute(
        `SELECT dt.document_id, dt.page_number, dt.content, d.title
         FROM document_text dt
         JOIN documents d ON d.id = dt.document_id
         WHERE ${exactPageConditions}`,
        exactPageParams
      );

      const dedupedMatches = new Map();
      [...exactMatches, ...nearbyMatches.map(addPageMetadata)].forEach((match) => {
        dedupedMatches.set(`${match.document_id}:${match.page_number}`, match);
      });
      candidateMatches = [...dedupedMatches.values()];
    }

    if (titleMatches.length === 0 && exactMatches.length === 0 && tocPageMatches.length === 0) {
      candidateMatches = candidateMatches.filter((match) => hasEnoughTermCoverage(match, terms));
    }

    if (candidateMatches.length === 0) {
      return buildNoMatchAnswer({ question });
    }

    const rankedMatches = candidateMatches
      .map((match) => ({
        ...match,
        score: scoreMatch(match, terms) + (exactMatchKeys.has(`${match.document_id}:${match.page_number}`) ? 100 : 0)
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    const imageConditions = rankedMatches
      .map(() => '(di.document_id = ? AND di.page_number = ?)')
      .join(' OR ');
    const imageParams = rankedMatches.flatMap((match) => [match.document_id, match.page_number]);
    const [pageImages] = imageConditions
      ? await pool.execute(
        `SELECT di.document_id, di.page_number, di.image_path, d.title
         FROM document_images di
         JOIN documents d ON d.id = di.document_id
         WHERE ${imageConditions}`,
        imageParams
      )
      : [[]];
    const rankedMatchByPage = new Map(
      rankedMatches.map((match) => [`${match.document_id}:${match.page_number}`, match])
    );

    const officialAnswer = buildOfficialTextAnswer(rankedMatches);
    const officialBlocks = officialAnswer
      ? [{
        type: 'preformatted',
        text: officialAnswer
      }]
      : buildOfficialTextBlocks(rankedMatches);
    const officialSummary = await generateOfficialTextSummaryWithOllama({
      question,
      officialText: officialAnswer
    });
    const answerBlocks = buildHybridOfficialBlocks({
      summary: officialSummary,
      officialBlocks
    });

    return {
      answer: blocksToText(answerBlocks) || buildHybridOfficialAnswer({
        summary: officialSummary,
        officialText: officialAnswer || buildExtractiveAnswer(rankedMatches)
      }),
      answerBlocks,
      answerMode: officialSummary ? 'database_text_with_ollama_summary' : 'database_text',
      images: pageImages.map((image) => ({
        documentId: image.document_id,
        title: image.title,
        pageNumber: image.page_number,
        printedPageNumber: rankedMatchByPage.get(`${image.document_id}:${image.page_number}`)?.printedPageNumber,
        pageLabel: rankedMatchByPage.get(`${image.document_id}:${image.page_number}`)?.pageLabel,
        url: `/${toPublicPath(image.image_path)}`
      })),
      sources: rankedMatches.map((match) => ({
        documentId: match.document_id,
        title: match.title,
        pageNumber: match.page_number,
        printedPageNumber: match.printedPageNumber,
        pageLabel: match.pageLabel
      }))
    };
  }

  return buildNoMatchAnswer({ question });
}

module.exports = {
  listKnowledgeTopics,
  searchDocuments
};
