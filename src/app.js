const express = require('express');
const cors = require('cors');
const path = require('path');
const swaggerUi = require('swagger-ui-express');
const { clientUrls } = require('./config/env');
const swaggerSpec = require('./config/swagger');
const authRoutes = require('./routes/authRoutes');
const chatRoutes = require('./routes/chatRoutes');
const documentRoutes = require('./routes/documentRoutes');
const embedOriginRoutes = require('./routes/embedOriginRoutes');
const scopeRoutes = require('./routes/scopeRoutes');
const userRoutes = require('./routes/userRoutes');

const app = express();

const corsOptions = {
  origin(origin, callback) {
    if (!origin || clientUrls.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error(`CORS blocked origin: ${origin}`));
  },
  credentials: true
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json());
app.use('/storage/images', express.static(path.resolve(__dirname, '..', 'storage/images')));
app.use('/storage/uploads', express.static(path.resolve(__dirname, '..', 'storage/uploads')));
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/embed-origins', embedOriginRoutes);
app.use('/api/chatbot-scopes', scopeRoutes);
app.use('/api/users', userRoutes);

app.use((req, res) => {
  res.status(404).json({ message: 'Route not found.' });
});

app.use((error, req, res, next) => {
  const status = error.status || 500;
  res.status(status).json({
    code: error.code,
    message: error.message || 'Internal server error.',
    approvalStatus: error.approvalStatus
  });
});

module.exports = app;
