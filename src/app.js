const express = require('express');
const cors = require('cors');
const path = require('path');
const { clientUrl } = require('./config/env');
const authRoutes = require('./routes/authRoutes');
const chatRoutes = require('./routes/chatRoutes');
const documentRoutes = require('./routes/documentRoutes');

const app = express();

app.use(cors({ origin: clientUrl }));
app.use(express.json());
app.use('/storage/images', express.static(path.resolve(__dirname, '..', 'storage/images')));

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/documents', documentRoutes);

app.use((req, res) => {
  res.status(404).json({ message: 'Route not found.' });
});

app.use((error, req, res, next) => {
  const status = error.status || 500;
  res.status(status).json({
    message: error.message || 'Internal server error.'
  });
});

module.exports = app;
