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

## Ollama RAG Answers

The chat endpoint searches MySQL for matching document pages, builds a document context, and sends that context to Ollama for a natural-language answer.

Install and run Ollama locally, then pull a model:

```bash
ollama serve
ollama pull qwen3:8b
```

Configure the API in `.env`:

```env
OLLAMA_ENABLED=true
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen3:8b
OLLAMA_REQUEST_TIMEOUT_MS=30000
```

If Ollama is offline or times out, the API falls back to the older extractive document answer so the chatbot still responds.

## OCR for Embedded Images

DOCX embedded images and PDF page images can be OCR processed with Tesseract so text inside screenshots becomes searchable.

Install Tesseract OCR, then configure:

```env
OCR_ENABLED=true
OCR_COMMAND=tesseract
OCR_LANGUAGE=eng
```

If Tesseract is not installed, document upload still works, but image OCR text is skipped and a warning is logged.

## Main API Routes

- `GET /api-docs`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/microsoft`
- `GET /api/documents`
- `POST /api/documents/upload`
- `POST /api/chat/ask`

## Microsoft 365 SSO

Set these values in `.env` from your Microsoft Entra app registration:

```env
MICROSOFT_TENANT_ID=your-tenant-id
MICROSOFT_CLIENT_ID=your-react-app-client-id
MICROSOFT_ALLOWED_DOMAIN=mcu.edu.ph
MICROSOFT_ADMIN_EMAILS=adminmcu@mcu.edu.ph
```

React signs in with MSAL, then sends the Microsoft `idToken` to:

```http
POST /api/auth/microsoft
```

```json
{
  "idToken": "microsoft-id-token-here"
}
```

The API validates the Microsoft token, creates or finds an `api_account`, and returns the normal API JWT.
New Microsoft users are created as `student` unless their email is listed in `MICROSOFT_ADMIN_EMAILS`.

`POST /api/documents/upload` expects multipart form data:

- `pdf`: the PDF file
- `title`: optional document title

Admin users can upload PDFs. Students can ask questions and view document results.
