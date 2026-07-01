const pool = require('../utils/db');
const { listKnowledgeTopics, searchDocuments } = require('../services/searchService');
const { getForbiddenEmbedMessage, isAllowedEmbedOrigin } = require('../services/embedSecurityService');
const { normalizeScope } = require('../services/scopeService');

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

async function askQuestion(req, res, next) {
  try {
    const { message } = req.body;
    const scope = await normalizeScope(req.body.scope || req.query.scope);
    const embedOrigin = req.body.embedOrigin || req.query.embedOrigin;

    if (!message) {
      return res.status(400).json({ message: 'Message is required.' });
    }

    if (!await isAllowedEmbedOrigin(scope, embedOrigin)) {
      return res.status(403).json({ message: getForbiddenEmbedMessage() });
    }

    const result = getSimpleChatReply(message) || await searchDocuments(message, { scope });
    const userId = await getChatLogUserId(req.user);

    await pool.execute(
      'INSERT INTO chat_logs (user_id, message, response) VALUES (?, ?, ?)',
      [userId, message, result.answer]
    );

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

    if (!await isAllowedEmbedOrigin(scope, embedOrigin)) {
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
