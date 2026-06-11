# MCU Chatbot API

Node.js + Express API for a university chatbot that uploads PDFs, extracts text and page images, stores searchable content in MySQL, and answers student questions from document content.

## Project Structure

```text
src/
  config/
  controllers/
  middleware/
  routes/
  services/
  utils/
  app.js
  server.js
database/schema.sql
storage/uploads/
storage/images/
```

Your original structure is correct for this project. The extra `config/` and `database/` folders keep environment settings and SQL setup separate from business logic.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy environment config:

```bash
cp .env.example .env
```

Set `UPLOAD_MAX_FILE_SIZE_MB` in `.env` if your PDFs are large.

3. Create the MySQL tables by running `database/schema.sql`.

4. Start the API:

```bash
npm run dev
```

## Main API Routes

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/documents`
- `POST /api/documents/upload`
- `POST /api/chat/ask`

`POST /api/documents/upload` expects multipart form data:

- `pdf`: the PDF file
- `title`: optional document title

Admin users can upload PDFs. Students can ask questions and view document results.
