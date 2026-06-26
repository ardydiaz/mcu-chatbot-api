const pool = require('../utils/db');
const { listKnowledgeTopics, searchDocuments } = require('../services/searchService');

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

    if (!message) {
      return res.status(400).json({ message: 'Message is required.' });
    }

    const result = await searchDocuments(message);
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
    const topicGroups = await listKnowledgeTopics();
    return res.json({ topicGroups });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getTopics,
  askQuestion
};
