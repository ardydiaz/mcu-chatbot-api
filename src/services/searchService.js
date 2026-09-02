const pool = require('../utils/db');
const { toPublicPath } = require('./fileService');
const {
  generateGeneralAnswerWithOllama,
  generateOfficialTextSummaryWithOllama,
  generateStructuredOfficialAnswerWithOllama
} = require('./ollamaService');
const { searchSemanticDocuments } = require('./qdrantService');

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
     WHERE (${conditions})`,
    params
  );

  return rows.map(addPageMetadata);
}

const INTENT_RULES = [
  {
    intent: 'financial_aid',
    questionPattern: /\b(tuition|financial|finance|aid|assistance|scholarship|scholarships|grant|grants|discount|fee|fees|payment|pay|cashier)\b/,
    titlePattern: /\b(scholarship|scholarships|grant|grants|tuition|payment|fee|fees|cashier|financial)\b/,
    contentPattern: /\b(scholarship|scholarships|grant|grants|financial assistance|needs based|needs-based|discount|tuition fee discount|tuition fee|payment mode|cashier)\b/,
    negativePattern: /\b(student support services|guidance counseling|health services|library|contact us|how can we help)\b/
  },
  {
    intent: 'enrollment',
    questionPattern: /\b(enroll|enrollment|enrolling|enlist|enlistment|online enlistment|student portal|compute tuition|payment mode)\b/,
    titlePattern: /\b(enrollment|enroll|enlistment)\b/,
    contentPattern: /\b(online enrollment|online enlistment|student portal|compute tuition fee|payment mode|online payment center)\b/
  },
  {
    intent: 'change_schedule',
    questionPattern: /\b(change schedule|change of schedule|add subject|adding subject|drop subject|dropping subject|change subject|class schedule|student adding|student changing)\b/,
    titlePattern: /\b(student adding|changing|change schedule|schedule)\b/,
    contentPattern: /\b(change of schedule|drop all checked subjects|additional registration|subject code|class schedule|adding changing)\b/
  },
  {
    intent: 'admission_requirements',
    questionPattern: /\b(admission|admissions|requirement|requirements|applicant|apply|entrance|passport size|birth certificate|transcript|tor)\b/,
    titlePattern: /\b(admission|admissions|requirements|applicant)\b/,
    contentPattern: /\b(admission requirements|passport size|birth certificate|original transcript|transfer credential|applicant|entrance examination)\b/
  },
  {
    intent: 'post_class_survey',
    questionPattern: /\b(post class|post-class|survey|office365|microsoft 365|o365)\b/,
    titlePattern: /\b(postclass|post class|post-class|survey)\b/,
    contentPattern: /\b(post-class survey|post class survey|office365|office 365|microsoft 365|login with office365)\b/
  },
  {
    intent: 'source_image',
    questionPattern: /\b(image|images|picture|pictures|screenshot|screenshots|source page|document preview|page preview)\b/,
    titlePattern: /.*/,
    contentPattern: /.*/
  },
  {
    intent: 'campus_contact',
    questionPattern: /\b(address|location|located|contact|phone|telephone|email|where is|how to contact)\b/,
    titlePattern: /\b(contact|directory|mcu|manila central university)\b/,
    contentPattern: /\b(edsa|caloocan|contact us|telephone|phone|email|address|directory)\b/
  }
];

function detectQuestionIntent(question) {
  const normalized = normalizeText(question);

  return INTENT_RULES.find((rule) => rule.questionPattern.test(normalized)) || null;
}

function isLikelyGeneralTechnologyQuestion(question) {
  const normalized = normalizeText(question);
  const hasUniversityContext = /\b(mcu|manila central university|university|student|students|enrollment|admission|registrar|cashier|tuition|scholarship|campus|portal|office365|microsoft 365|post class|post-class)\b/.test(normalized);
  const hasGeneralAiTopic = /\b(react|node|nodejs|node js|javascript|typescript|api|apis|crud|database|mysql|qdrant|ollama|frontend|backend|code|coding|programming|component|components|functionality|feature|features|framework|library|server|express|tailwind|css|html|facebook|google|youtube|openai|chatgpt|gemini|developer|developed|created|invented)\b/.test(normalized);

  return hasGeneralAiTopic && !hasUniversityContext;
}

function isIntentTitleMatch(match, intentRule) {
  return Boolean(intentRule) && intentRule.titlePattern.test(normalizeText(match.title || ''));
}

function isIntentContentMatch(match, intentRule) {
  if (!intentRule) {
    return false;
  }

  const searchableText = normalizeText(`${match.title || ''} ${match.content || ''}`);

  return intentRule.contentPattern.test(searchableText);
}

function getIntentFilteredMatches(matches, intentRule) {
  if (!intentRule || intentRule.intent === 'source_image') {
    return matches;
  }

  const titleMatches = matches.filter((match) => isIntentTitleMatch(match, intentRule));

  if (titleMatches.length > 0) {
    return titleMatches;
  }

  const contentMatches = matches.filter((match) => isIntentContentMatch(match, intentRule));

  if (contentMatches.length > 0) {
    return contentMatches;
  }

  if (['financial_aid', 'enrollment', 'change_schedule', 'admission_requirements', 'post_class_survey'].includes(intentRule.intent)) {
    return [];
  }

  return matches;
}

function getIntentBoost(match, question) {
  const intentRule = detectQuestionIntent(question);

  if (!intentRule) {
    return 0;
  }

  if (isIntentTitleMatch(match, intentRule)) {
    return 40;
  }

  if (isIntentContentMatch(match, intentRule)) {
    return 25;
  }

  if (intentRule.negativePattern?.test(normalizeText(`${match.title || ''} ${match.content || ''}`))) {
    return -15;
  }

  return 0;
}

function scoreMatch(match, terms, question = '') {
  const content = match.content.toLowerCase();
  const firstLines = content.split('\n').slice(0, 8).join(' ');
  const termHits = terms.filter((term) => content.includes(term)).length;
  const headingHits = terms.filter((term) => firstLines.includes(term)).length;
  const tocPenalty = /contents|\.{5,}| \d+-\d+/.test(firstLines) ? 5 : 0;
  const semanticScore = Number(match.semanticScore || 0) * 10;

  return (headingHits * 5) + termHits + semanticScore + getIntentBoost(match, question) - tocPenalty;
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

function isLeadershipQuestion(question) {
  const normalized = normalizeText(question);

  return (
    /\bwho\s+(is|are)\b/.test(normalized) ||
    /\bcurrent\b|\bpresent\b/.test(normalized)
  ) && /\b(president|director|dean|chairman|chairperson|principal|head)\b/.test(normalized);
}

function isUniversitySpecificFactQuestion(question) {
  const normalized = normalizeText(question);
  const mentionsUniversity = /\b(mcu|manila central university|university)\b/.test(normalized);
  const asksOfficialFact = (
    /\b(who|when|where|which|how much|how many|current|present|official|exact)\b/.test(normalized) ||
    /\b(president|director|dean|chairman|chairperson|principal|head|deadline|date|schedule|fee|fees|tuition|contact|email|phone|address|requirement|requirements|policy)\b/.test(normalized)
  );

  return mentionsUniversity && asksOfficialFact;
}

function getLeadershipRole(question) {
  return normalizeText(question).match(/\b(president|director|dean|chairman|chairperson|principal|head)\b/)?.[1] || '';
}

function isHistoricalLeadershipMatch(match) {
  const title = normalizeText(match.title);
  const content = normalizeText(String(match.content || '').slice(0, 2500));
  const yearCount = (content.match(/\b(19|20)\d{2}\b/g) || []).length;

  return (
    /\bhistory\b|\bheritage\b|\blegacy\b/.test(title) ||
    (yearCount >= 3 && /\bfounder\b|\bfounded\b|\btimeline\b|\bhistory\b|\blegacy\b/.test(content))
  );
}

function isDirectLeadershipMatch(match, question) {
  const role = getLeadershipRole(question);
  const searchableText = normalizeText(`${match.title || ''} ${match.content || ''}`);
  const title = normalizeText(match.title || '');
  const firstContent = normalizeText(String(match.content || '').slice(0, 1600));

  if (!role || !searchableText.includes(role)) {
    return false;
  }

  if (isHistoricalLeadershipMatch(match)) {
    return false;
  }

  return (
    /\bdirectory\b|\badministration\b|\bleadership\b|\boffice of the president\b/.test(title) ||
    /\bdirectory\b|\badministration\b|\bleadership\b|\boffice of the president\b/.test(firstContent) ||
    new RegExp(`\\b(current|present|university|school|college)\\s+${role}\\b`).test(firstContent) ||
    new RegExp(`\\b${role}\\s*[:\\-]`).test(firstContent)
  );
}

function isAddressQuestion(question) {
  const normalized = normalizeText(question);

  return (
    /\b(address|location|located|where is|where can i find|campus)\b/.test(normalized) &&
    /\b(mcu|manila central university|university)\b/.test(normalized)
  );
}

function isContactQuestion(question) {
  const normalized = normalizeText(question);

  return /\b(contact|phone|telephone|email|number|call)\b/.test(normalized)
    && /\b(mcu|manila central university|university)\b/.test(normalized);
}

function getAddressLines(match) {
  const lines = String(match.content || '')
    .split(/\r?\n/)
    .map(cleanOfficialLine)
    .filter(Boolean)
    .filter(isDisplayableOfficialLine);

  return lines.filter((line) => {
    if (/^admission requirements/i.test(line)) {
      return false;
    }

    return (
      /\b(edsa|epifanio de los santos|1400)\b/i.test(line) ||
      /^mcu,\s*edsa/i.test(line) ||
      /^manila central university,\s*edsa/i.test(line)
    );
  }).map((line) => line.replace(/\s+Email\b.*$/i, '').trim());
}

function getContactLines(match) {
  const lines = String(match.content || '')
    .split(/\r?\n/)
    .map(cleanOfficialLine)
    .filter(Boolean)
    .filter(isDisplayableOfficialLine);

  return lines
    .filter((line) => (
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(line) ||
      /\b(?:\+?63|0)\d[\d\s().-]{7,}\d\b/.test(line) ||
      /https?:\/\/mcu\.edu\.ph\/contact-us\/?/i.test(line)
    ))
    .map((line) => line.replace(/\s+/g, ' ').trim());
}

function buildContactAnswer(matches, question) {
  const normalizedQuestion = normalizeText(question);
  const wantsPhone = /\b(phone|telephone|number|call)\b/.test(normalizedQuestion);
  const seen = new Set();
  const contactLines = [];

  matches.forEach((match) => {
    getContactLines(match).forEach((line) => {
      if (wantsPhone && !/\b(?:\+?63|0)\d[\d\s().-]{7,}\d\b/.test(line)) {
        return;
      }

      const normalized = normalizeText(line);

      if (!seen.has(normalized)) {
        seen.add(normalized);
        contactLines.push(line);
      }
    });
  });

  if (contactLines.length === 0) {
    return null;
  }

  const answer = contactLines.slice(0, 4).join('\n');

  return {
    answer,
    answerBlocks: [
      {
        type: 'preformatted',
        text: answer
      }
    ],
    answerMode: 'database_text',
    images: [],
    sources: matches.slice(0, 3).map((match) => ({
      documentId: match.document_id,
      title: match.title,
      pageNumber: match.page_number,
      printedPageNumber: match.printedPageNumber,
      pageLabel: match.pageLabel
    }))
  };
}

function buildAddressAnswer(matches) {
  const seen = new Set();
  const addressLines = [];

  matches.forEach((match) => {
    getAddressLines(match).forEach((line) => {
      const normalized = normalizeText(line);

      if (!seen.has(normalized)) {
        seen.add(normalized);
        addressLines.push(line);
      }
    });
  });

  if (addressLines.length === 0) {
    return null;
  }

  const rankedAddressLines = addressLines
    .map((line) => ({
      line,
      score:
        (/campus/i.test(line) ? 4 : 0) +
        (/monumento/i.test(line) ? 3 : 0) +
        (/philippines/i.test(line) ? 2 : 0) +
        (/1400/i.test(line) ? 2 : 0) +
        (/edsa/i.test(line) ? 1 : 0)
    }))
    .sort((a, b) => b.score - a.score || b.line.length - a.line.length);
  const answer = rankedAddressLines[0].line;

  return {
    answer,
    answerBlocks: [
      {
        type: 'preformatted',
        text: answer
      }
    ],
    answerMode: 'database_text',
    images: [],
    sources: matches.slice(0, 3).map((match) => ({
      documentId: match.document_id,
      title: match.title,
      pageNumber: match.page_number,
      printedPageNumber: match.printedPageNumber,
      pageLabel: match.pageLabel
    }))
  };
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

function isRawDocumentMarkup(value) {
  const text = normalizeText(String(value || '').slice(0, 2500));

  return (
    text.includes('schemas microsoft com office word') ||
    text.includes('schemas-microsoft-com office word') ||
    text.includes('microsoft word 15') ||
    text.includes('word document') ||
    text.includes('filelist xml') ||
    text.includes('mso ') ||
    text.includes('xmlns v') ||
    text.includes('xmlns o') ||
    text.includes('xmlns w')
  );
}

function isRawMarkupLine(line) {
  return /xmlns[:=]|schemas[-\s]microsoft|microsoft word|filelist\.xml|mso-|mso\s|office:word|urn:schemas/i.test(line);
}

function isDisplayableOfficialLine(line) {
  return !/^Page\s*\|\s*\d+$/i.test(line) && !isTableOfContentsLine(line) && !isRawMarkupLine(line);
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

function getCleanOfficialLines(content) {
  return String(content || '')
    .split(/\r?\n/)
    .map(cleanOfficialLine)
    .filter(Boolean)
    .filter(isDisplayableOfficialLine);
}

function getLineTermHits(line, terms) {
  const normalizedLine = normalizeText(line);

  return terms.filter((term) => normalizedLine.includes(term)).length;
}

function isGenericInstitutionQuery(normalizedExact, terms) {
  const institutionTerms = new Set(['mcu', 'manila', 'central', 'university']);

  return (
    normalizedExact === 'mcu' ||
    normalizedExact === 'manila central university' ||
    (terms.length > 0 && terms.every((term) => institutionTerms.has(term)))
  );
}

function isDocumentOverviewQuestion(question) {
  const normalized = normalizeText(question);

  return /^(what is|what are|tell me about|explain|describe|overview of|give me|show me)\b/.test(normalized);
}

function hasTitleOverviewMatch(matches, exactSearchPhrase, question) {
  if (!isDocumentOverviewQuestion(question)) {
    return false;
  }

  const normalizedExact = normalizeText(exactSearchPhrase || question);

  if (normalizedExact.length < 4) {
    return false;
  }

  return matches.some((match) => normalizeText(match.title || '').includes(normalizedExact));
}

function getTitleOverviewDocumentId(matches, exactSearchPhrase, question) {
  if (!hasTitleOverviewMatch(matches, exactSearchPhrase, question)) {
    return null;
  }

  const normalizedExact = normalizeText(exactSearchPhrase || question);
  const titleMatches = matches
    .filter((match) => normalizeText(match.title || '').includes(normalizedExact))
    .map((match) => ({
      ...match,
      titleScore: normalizeText(match.title || '') === normalizedExact ? 2 : 1
    }))
    .sort((a, b) => b.titleScore - a.titleScore || a.page_number - b.page_number);

  return titleMatches[0]?.document_id || null;
}

function getRelevantOfficialLines(match, { question, terms = [], exactSearchPhrase = '' } = {}) {
  const lines = getCleanOfficialLines(match.content);
  const fullText = lines.join('\n');

  if (fullText.length <= 3000 || lines.length <= 35) {
    return lines;
  }

  const normalizedTitle = normalizeText(match.title);
  const normalizedExact = normalizeText(exactSearchPhrase || question);
  const genericInstitutionQuery = isGenericInstitutionQuery(normalizedExact, terms);

  if (!genericInstitutionQuery && normalizedExact.length > 3 && normalizedTitle.includes(normalizedExact)) {
    return lines;
  }

  const hitIndexes = lines
    .map((line, index) => {
      const normalizedLine = normalizeText(line);
      const exactHit = normalizedExact.length > 3 && normalizedLine.includes(normalizedExact);
      const requiredHits = terms.length <= 1 ? 1 : Math.min(2, terms.length);
      const termHit = getLineTermHits(line, terms) >= requiredHits;

      return exactHit || termHit ? index : -1;
    })
    .filter((index) => index >= 0)
    .slice(0, 4);

  if (hitIndexes.length === 0) {
    if (genericInstitutionQuery) {
      return [];
    }

    return lines.slice(0, 45);
  }

  const selectedLines = [];
  const seenIndexes = new Set();
  const ranges = hitIndexes.map((index) => [
    Math.max(0, index - 6),
    Math.min(lines.length - 1, index + 10)
  ]);

  if (lines[0]) {
    selectedLines.push(lines[0]);
    seenIndexes.add(0);
  }

  ranges.forEach(([start, end], rangeIndex) => {
    if (rangeIndex > 0 && selectedLines[selectedLines.length - 1] !== '') {
      selectedLines.push('');
    }

    for (let index = start; index <= end; index += 1) {
      if (!seenIndexes.has(index)) {
        selectedLines.push(lines[index]);
        seenIndexes.add(index);
      }
    }
  });

  return selectedLines.filter((line, index, allLines) => line || allLines[index - 1]);
}

function buildOfficialTextAnswer(matches, options = {}) {
  return matches
    .slice()
    .sort((a, b) => a.page_number - b.page_number)
    .map((match) => {
      const lines = getRelevantOfficialLines(match, options);

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

async function hydrateMatchesWithFullPageContent(matches) {
  if (!matches.length) {
    return matches;
  }

  const pageConditions = matches
    .map(() => '(dt.document_id = ? AND dt.page_number = ?)')
    .join(' OR ');
  const pageParams = matches.flatMap((match) => [match.document_id, match.page_number]);
  const [pageRows] = await pool.execute(
    `SELECT dt.document_id, dt.page_number, dt.content, d.title
     FROM document_text dt
     JOIN documents d ON d.id = dt.document_id
     WHERE ${pageConditions}`,
    pageParams
  );
  const fullPageByKey = new Map(
    pageRows.map((row) => [`${row.document_id}:${row.page_number}`, row])
  );

  return matches.map((match) => {
    const fullPage = fullPageByKey.get(`${match.document_id}:${match.page_number}`);

    if (!fullPage?.content) {
      return match;
    }

    return addPageMetadata({
      ...match,
      title: fullPage.title || match.title,
      content: fullPage.content
    });
  });
}

async function getDocumentPageMatches(documentId, maxPages = 30) {
  if (!documentId) {
    return [];
  }

  const safeMaxPages = Math.min(100, Math.max(1, Number(maxPages) || 30));
  const [rows] = await pool.execute(
    `SELECT dt.document_id, dt.page_number, dt.content, d.title
     FROM document_text dt
     JOIN documents d ON d.id = dt.document_id
     WHERE dt.document_id = ?
     ORDER BY dt.page_number ASC
     LIMIT ${safeMaxPages}`,
    [documentId]
  );

  return rows
    .filter((match) => !isRawDocumentMarkup(match.content))
    .map(addPageMetadata);
}

function blocksToText(blocks) {
  return blocks
    .map((block) => {
      if (block.type === 'list') {
        return block.items
          .map((item, index) => {
            if (typeof item === 'string') {
              return `${index + 1}. ${item}`;
            }

            return `${item.marker || index + 1}. ${item.value || ''}`.trim();
          })
          .join('\n');
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
            SUBSTRING_INDEX(GROUP_CONCAT(d.topic_category ORDER BY d.created_at DESC SEPARATOR '||'), '||', 1) AS topic_category,
            SUBSTRING_INDEX(GROUP_CONCAT(d.suggested_prompt ORDER BY d.created_at DESC SEPARATOR '||'), '||', 1) AS suggested_prompt,
            SUBSTRING_INDEX(GROUP_CONCAT(dt.content ORDER BY d.created_at DESC, dt.page_number ASC SEPARATOR ' '), ' ', 120) AS sample_content
     FROM documents d
     LEFT JOIN document_text dt ON dt.document_id = d.id
     WHERE d.site_scope = ?
       AND d.show_as_topic = 1
     GROUP BY d.title
     ORDER BY created_at DESC`,
    [scope]
  );
  const groups = new Map();

  documents.forEach((document) => {
    const category = document.topic_category || getTopicCategory(document);
    const item = {
      id: document.id,
      icon: getTopicIcon(document.title),
      label: document.title,
      prompt: document.suggested_prompt || `What is ${document.title}?`
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

function getTruncatedText(value, maxLength = 2200) {
  const text = String(value || '').trim();

  if (text.length <= maxLength) {
    return {
      text,
      fullText: text,
      isTruncated: false
    };
  }

  const boundary = Math.max(
    text.lastIndexOf('\n\n', maxLength),
    text.lastIndexOf('\n', maxLength),
    text.lastIndexOf('.', maxLength)
  );
  const safeCutoff = boundary > maxLength * 0.65 ? boundary + 1 : maxLength;

  return {
    text: text.slice(0, safeCutoff).trim(),
    fullText: text,
    isTruncated: true
  };
}

function getConciseOfficialExcerpt(officialText) {
  const lines = String(officialText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(latest @mcu|blogs|show all|learn more|apply now)$/i.test(line))
    .filter((line) => !/^mcu college .*2026/i.test(line));
  const excerpt = lines.join('\n');

  return getTruncatedText(excerpt, 2200);
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
  const leadershipQuestion = isLeadershipQuestion(question);
  const addressQuestion = isAddressQuestion(question);
  const intentRule = detectQuestionIntent(question);

  if (!intentRule && isLikelyGeneralTechnologyQuestion(question)) {
    return buildNoMatchAnswer({ question });
  }

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
  const semanticRows = await searchSemanticDocuments(question, { scope });
  const dedupedRows = new Map();
  [...titleRows, ...exactPhraseRows, ...semanticRows, ...broadRows].forEach((row) => {
    dedupedRows.set(`${row.document_id}:${row.page_number}`, row);
  });
  const matches = [...dedupedRows.values()];

  if (matches.length > 0) {
    const enrichedMatches = matches
      .filter((match) => !isRawDocumentMarkup(match.content))
      .map(addPageMetadata);

    if (enrichedMatches.length === 0) {
      return buildNoMatchAnswer({ question });
    }

    if (leadershipQuestion) {
      const directLeadershipMatches = enrichedMatches.filter((match) => isDirectLeadershipMatch(match, question));

      if (directLeadershipMatches.length === 0) {
        return buildNoOfficialMatchAnswer();
      }
    }

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

    if (
      isUniversitySpecificFactQuestion(question) &&
      !intentRule &&
      !leadershipQuestion &&
      !addressQuestion &&
      exactMatches.length === 0 &&
      titleMatches.length === 0 &&
      tocPageMatches.length === 0
    ) {
      return buildNoOfficialMatchAnswer();
    }

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
         WHERE (${exactPageConditions})`,
        exactPageParams
      );

      const dedupedMatches = new Map();
      [...exactMatches, ...nearbyMatches.map(addPageMetadata)].forEach((match) => {
        dedupedMatches.set(`${match.document_id}:${match.page_number}`, match);
      });
      candidateMatches = [...dedupedMatches.values()];
    }

    if (intentRule) {
      candidateMatches = getIntentFilteredMatches(candidateMatches, intentRule);
    }

    if (titleMatches.length === 0 && exactMatches.length === 0 && tocPageMatches.length === 0 && !intentRule) {
      candidateMatches = candidateMatches.filter((match) => hasEnoughTermCoverage(match, terms));
    }

    if (leadershipQuestion) {
      candidateMatches = candidateMatches.filter((match) => isDirectLeadershipMatch(match, question));
    }

    if (candidateMatches.length === 0) {
      if (leadershipQuestion) {
        return buildNoOfficialMatchAnswer();
      }

      return buildNoMatchAnswer({ question });
    }

    if (isContactQuestion(question)) {
      const contactAnswer = buildContactAnswer(candidateMatches, question);

      if (contactAnswer) {
        return contactAnswer;
      }

      return buildNoOfficialMatchAnswer();
    }

    if (addressQuestion) {
      const addressAnswer = buildAddressAnswer(candidateMatches);

      if (addressAnswer) {
        return addressAnswer;
      }

      return buildNoOfficialMatchAnswer();
    }

    const overviewDocumentId = getTitleOverviewDocumentId(candidateMatches, exactSearchPhrase, question);
    const useCompleteDocumentOverview = Boolean(overviewDocumentId);
    const maxRankedMatches = isGenericInstitutionQuery(normalizedExactPhrase, terms)
      ? 1
      : useCompleteDocumentOverview ? 6 : 2;
    const rankedMatches = candidateMatches
      .map((match) => ({
        ...match,
        score: scoreMatch(match, terms, question) + (exactMatchKeys.has(`${match.document_id}:${match.page_number}`) ? 100 : 0)
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, maxRankedMatches);

    const hydratedRankedMatches = useCompleteDocumentOverview
      ? await getDocumentPageMatches(overviewDocumentId)
      : await hydrateMatchesWithFullPageContent(rankedMatches);

    if (hydratedRankedMatches.length === 0) {
      return buildNoMatchAnswer({ question });
    }
    const imageConditions = hydratedRankedMatches
      .map(() => '(di.document_id = ? AND di.page_number = ?)')
      .join(' OR ');
    const imageParams = hydratedRankedMatches.flatMap((match) => [match.document_id, match.page_number]);
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
      hydratedRankedMatches.map((match) => [`${match.document_id}:${match.page_number}`, match])
    );

    const officialAnswer = buildOfficialTextAnswer(hydratedRankedMatches, {
      question,
      terms,
      exactSearchPhrase
    });
    let answerBlocks = null;
    let answerMode = 'database_text';

    if (useCompleteDocumentOverview) {
      const exactOfficialAnswer = getTruncatedText(officialAnswer, 12000);

      answerBlocks = exactOfficialAnswer.text
        ? [{
          type: 'preformatted',
          text: exactOfficialAnswer.text,
          fullText: exactOfficialAnswer.fullText,
          isTruncated: exactOfficialAnswer.isTruncated
        }]
        : buildOfficialTextBlocks(hydratedRankedMatches);
      answerMode = 'database_text_exact_overview';
    } else {
      answerBlocks = await generateStructuredOfficialAnswerWithOllama({
        question,
        officialText: officialAnswer,
        detailLevel: 'compact'
      });
      answerMode = answerBlocks
        ? 'database_text_structured_with_ollama'
        : 'database_text';
    }

    if (!answerBlocks) {
      const officialSummary = await generateOfficialTextSummaryWithOllama({
        question,
        officialText: officialAnswer
      });
      const displayOfficialAnswer = officialSummary
        ? getConciseOfficialExcerpt(officialAnswer)
        : getTruncatedText(officialAnswer, useCompleteDocumentOverview ? 5200 : 2200);
      const officialBlocks = displayOfficialAnswer.text
        ? [{
          type: 'preformatted',
          text: displayOfficialAnswer.text,
          fullText: displayOfficialAnswer.fullText,
          isTruncated: displayOfficialAnswer.isTruncated
        }]
        : buildOfficialTextBlocks(hydratedRankedMatches);

      answerBlocks = buildHybridOfficialBlocks({
        summary: officialSummary,
        officialBlocks
      });
      answerMode = officialSummary ? 'database_text_with_ollama_summary' : 'database_text';
    }

    return {
      answer: blocksToText(answerBlocks) || buildHybridOfficialAnswer({
        summary: '',
        officialText: buildExtractiveAnswer(hydratedRankedMatches)
      }),
      answerBlocks,
      answerMode,
      images: pageImages.map((image) => ({
        documentId: image.document_id,
        title: image.title,
        pageNumber: image.page_number,
        printedPageNumber: rankedMatchByPage.get(`${image.document_id}:${image.page_number}`)?.printedPageNumber,
        pageLabel: rankedMatchByPage.get(`${image.document_id}:${image.page_number}`)?.pageLabel,
        url: `/${toPublicPath(image.image_path)}`
      })),
      sources: hydratedRankedMatches.map((match) => ({
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
