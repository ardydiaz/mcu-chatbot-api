const pool = require('../utils/db');
const { listKnowledgeTopics, searchDocuments } = require('../services/searchService');
const { getForbiddenEmbedMessage, isAllowedEmbedOrigin } = require('../services/embedSecurityService');
const { normalizeScope } = require('../services/scopeService');
const { generateConversationalAnswerWithOllama } = require('../services/ollamaService');

function normalizeChatMessage(message) {
  return String(message || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getSimpleChatReply(message) {
  const normalized = normalizeChatMessage(message);

  if (/^(hi|hello|hey|good morning|good afternoon|good evening|mabuhay)$/.test(normalized)) {
    return {
      answer: 'Hello! I am MCU Guide. How can I help you today?',
      answerBlocks: [
        {
          type: 'p',
          text: 'Hello! I am MCU Guide. How can I help you today?'
        }
      ],
      answerMode: 'greeting',
      images: [],
      sources: []
    };
  }

  if (/^(thanks|thank you|thankyou|ty|okay|ok)$/.test(normalized)) {
    return {
      answer: 'You are welcome. I am here if you need help with university documents or student services.',
      answerBlocks: [
        {
          type: 'p',
          text: 'You are welcome. I am here if you need help with university documents or student services.'
        }
      ],
      answerMode: 'small_talk',
      images: [],
      sources: []
    };
  }

  if (normalized.length > 0 && normalized.length < 3) {
    return {
      answer: 'Please type a more specific question, such as “How do I enroll?” or “Show source page for tuition payment.”',
      answerBlocks: [
        {
          type: 'p',
          text: 'Please type a more specific question, such as “How do I enroll?” or “Show source page for tuition payment.”'
        }
      ],
      answerMode: 'needs_more_detail',
      images: [],
      sources: []
    };
  }

  return null;
}

function isEmbedRequest(value) {
  return value === true || value === 'true' || value === '1' || value === 1;
}

function sanitizeConversationContext(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item) => ['user', 'assistant'].includes(item?.role) && item?.text)
    .slice(-6)
    .map((item) => ({
      role: item.role,
      text: String(item.text).slice(0, 2000)
    }));
}

function isContextFollowUp(message, conversationContext) {
  if (conversationContext.length === 0) {
    return false;
  }

  const normalized = normalizeChatMessage(message);
  const words = normalized.split(/\s+/).filter(Boolean);

  if (words.length === 0) {
    return false;
  }

  const hasSearchTopic = /\b(mcu|manila central university|university|enroll|enrollment|enlistment|tuition|fee|fees|payment|scholarship|grant|admission|requirements?|schedule|subject|post\s*class|survey|address|contact|image|source|document|page|privacy|policy)\b/.test(normalized);

  if (hasSearchTopic) {
    return false;
  }

  const hasReferenceWord = /\b(this|that|it|its|they|them|those|these|he|she|him|her|there|same|project|one)\b/.test(normalized);
  const hasArticleReference = /^(the|a|an)\b/.test(normalized) && words.length <= 6;
  const hasContinuationWord = /\b(also|again|more|example|examples|like|such as|functionality|feature|features)\b/.test(normalized);
  const isShortFollowUp = words.length <= 4 && /^(yes|no|why|how|what|explain|more|continue|is|are|can|could|so|then)\b/.test(normalized);

  return hasReferenceWord || hasArticleReference || hasContinuationWord || isShortFollowUp;
}

function buildConversationalReply(answer) {
  return {
    answer,
    answerBlocks: [
      {
        type: 'p',
        text: answer
      }
    ],
    answerMode: 'conversation_context',
    images: [],
    sources: []
  };
}

async function getChatLogUserId(user) {
  if (!user?.email) {
    return null;
  }

  const [rows] = await pool.execute(
    'SELECT id FROM api_account WHERE email = ? LIMIT 1',
    [user.email]
  );

  if (rows[0]) {
    return rows[0].id;
  }

  const [result] = await pool.execute(
    `INSERT INTO api_account (name, email, password, role, approval_status)
     VALUES (?, ?, NULL, ?, ?)`,
    [user.name || user.email, user.email, user.role || 'student', user.approvalStatus || 'approved']
  );

  return result.insertId;
}

async function saveChatLog({ userId, message, response }) {
  try {
    await pool.execute(
      'INSERT INTO chat_logs (user_id, message, response) VALUES (?, ?, ?)',
      [userId, message, response]
    );
  } catch (error) {
    console.warn('Chat log was not saved:', error.message);
  }
}

async function askQuestion(req, res, next) {
  try {
    const { message } = req.body;
    const scope = await normalizeScope(req.body.scope || req.query.scope);
    const embedOrigin = req.body.embedOrigin || req.query.embedOrigin;
    const embedToken = req.body.embedToken || req.query.embedToken;
    const isEmbed = isEmbedRequest(req.body.isEmbed || req.query.isEmbed);
    const conversationContext = sanitizeConversationContext(req.body.conversationContext);

    if (!message) {
      return res.status(400).json({ message: 'Message is required.' });
    }

    if (isEmbed && !await isAllowedEmbedOrigin(scope, embedOrigin, embedToken)) {
      return res.status(403).json({ message: getForbiddenEmbedMessage() });
    }

    const conversationalAnswer = isContextFollowUp(message, conversationContext)
      ? await generateConversationalAnswerWithOllama({ question: message, conversationContext })
      : null;
    const result = getSimpleChatReply(message)
      || (conversationalAnswer ? buildConversationalReply(conversationalAnswer) : null)
      || await searchDocuments(message, { scope });
    const userId = await getChatLogUserId(req.user);

    await saveChatLog({ userId, message, response: result.answer });

    return res.json({
      question: message,
      ...result
    });
  } catch (error) {
    return next(error);
  }
}

async function getTopics(req, res, next) {
  try {
    const scope = await normalizeScope(req.query.scope);
    const embedOrigin = req.query.embedOrigin;
    const embedToken = req.query.embedToken;
    const isEmbed = isEmbedRequest(req.query.isEmbed);

    if (isEmbed && !await isAllowedEmbedOrigin(scope, embedOrigin, embedToken)) {
      return res.status(403).json({ message: getForbiddenEmbedMessage(), topicGroups: [] });
    }

    const topicGroups = await listKnowledgeTopics({ scope });
    return res.json({ topicGroups });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getTopics,
  askQuestion
};
