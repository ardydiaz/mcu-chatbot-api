const pool = require('../utils/db');
const { searchDocuments } = require('../services/searchService');

async function askQuestion(req, res, next) {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ message: 'Message is required.' });
    }

    const result = await searchDocuments(message);

    await pool.execute(
      'INSERT INTO chat_logs (user_id, message, response) VALUES (?, ?, ?)',
      [req.user?.id || null, message, result.answer]
    );

    return res.json({
      question: message,
      ...result
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  askQuestion
};
