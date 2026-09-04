const pool = require('../utils/db');
const { listKnowledgeTopics, searchDocuments } = require('../services/searchService');
const { getForbiddenEmbedMessage, isAllowedEmbedOrigin } = require('../services/embedSecurityService');
const { normalizeScope } = require('../services/scopeService');

const MAX_CHAT_MESSAGE_LENGTH = 2000;

function sanitizeQuestionInput(value) {
  return String(value || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();
}

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

function normalizeApiAccountRole(value) {
  return ['student', 'admin'].includes(value) ? value : 'student';
}

function normalizeApprovalStatus(value) {
  return ['pending', 'approved', 'rejected'].includes(value) ? value : 'approved';
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
    [
      user.name || user.email,
      user.email,
      normalizeApiAccountRole(user.role),
      normalizeApprovalStatus(user.approvalStatus)
    ]
  );

  return result.insertId;
}

function getChatLogUserAccountId(user) {
  return user?.id ? Number(user.id) : null;
}

async function saveChatLog({ userId, userAccountId, message, response }) {
  try {
    await pool.execute(
      'INSERT INTO chat_logs (user_id, user_account_id, message, response) VALUES (?, ?, ?, ?)',
      [userId, userAccountId, message, response]
    );
  } catch (error) {
    if (error.code === 'ER_BAD_FIELD_ERROR') {
      await pool.execute(
        'INSERT INTO chat_logs (user_id, message, response) VALUES (?, ?, ?)',
        [userId, message, response]
      );
      return;
    }

    console.warn('Chat log was not saved:', error.message);
  }
}

async function askQuestion(req, res, next) {
  try {
    const message = sanitizeQuestionInput(req.body.message);
    const scope = await normalizeScope(req.body.scope || req.query.scope);
    const embedOrigin = req.body.embedOrigin || req.query.embedOrigin;
    const embedToken = req.body.embedToken || req.query.embedToken;
    const isEmbed = isEmbedRequest(req.body.isEmbed || req.query.isEmbed);
    if (!message) {
      return res.status(400).json({ message: 'Message is required.' });
    }

    if (message.length > MAX_CHAT_MESSAGE_LENGTH) {
      return res.status(413).json({ message: `Message is too long. Please keep it under ${MAX_CHAT_MESSAGE_LENGTH} characters.` });
    }

    if (isEmbed && !await isAllowedEmbedOrigin(scope, embedOrigin, embedToken)) {
      return res.status(403).json({ message: getForbiddenEmbedMessage() });
    }

    const result = getSimpleChatReply(message)
      || await searchDocuments(message, { scope });
    let userId = null;

    try {
      userId = await getChatLogUserId(req.user);
    } catch (error) {
      console.warn('Chat log user was not resolved:', error.message);
    }

    await saveChatLog({
      userId,
      userAccountId: getChatLogUserAccountId(req.user),
      message,
      response: result.answer
    });

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
