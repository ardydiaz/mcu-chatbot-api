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

### Runtime Dependencies

The API depends on these local services:

- **MySQL** - stores users, documents, extracted text, chat logs, website access, and admin data.
- **Ollama** - generates chatbot answers and document summaries.
- **Ollama embedding model** - generates vectors for Qdrant semantic search.
- **Qdrant** - vector database used for semantic document search.
- **Tesseract OCR** - optional, used to read text from embedded images/screenshots.

2. Copy environment config:

```bash
cp .env.example .env
```

Set `UPLOAD_MAX_FILE_SIZE_MB` in `.env` if your PDFs are large.

3. Create or update the MySQL tables:

```bash
npm run migrate
```

The migration command works like a lightweight Laravel migration runner. It creates the database if needed, runs `database/schema.sql`, records completed migrations in `schema_migrations`, and skips migrations that were already applied.

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

For faster official document answers, keep database answers in fast mode. This skips optional Ollama rewriting when the uploaded documents already contain the answer:

```env
FAST_DATABASE_ANSWERS=true
QDRANT_REQUEST_TIMEOUT_MS=1500
```

Set `FAST_DATABASE_ANSWERS=false` only if you prefer slower AI-rewritten answers over speed.

## Qdrant Semantic Search

Qdrant improves document retrieval by matching meaning, not only exact keywords. MySQL remains the main database, while Qdrant stores document text vectors.

Start Qdrant locally, then open:

```text
http://localhost:6333
```

Expected response:

```json
{"title":"qdrant - vector search engine"}
```

Pull the Ollama embedding model:

```bash
ollama pull nomic-embed-text
```

Configure `.env`:

```env
QDRANT_ENABLED=true
QDRANT_URL=http://localhost:6333
QDRANT_COLLECTION=mcu_knowledge_base
QDRANT_API_KEY=
OLLAMA_EMBED_MODEL=nomic-embed-text
```

Reindex existing uploaded documents:

```bash
npm run qdrant:reindex
```

Successful output should show chunks indexed:

```text
Qdrant reindex complete. 116 chunks indexed from 8 documents.
```

Check the collection:

```text
http://localhost:6333/collections/mcu_knowledge_base
```

`points_count` should be greater than `0`.

## OCR for Embedded Images

DOCX embedded images and PDF page images can be OCR processed with Tesseract so text inside screenshots becomes searchable.

Install Tesseract OCR, then configure:

```env
OCR_ENABLED=true
OCR_COMMAND=tesseract
OCR_LANGUAGE=eng
```

If Tesseract is not installed, document upload still works, but image OCR text is skipped and a warning is logged.

## Document Page Capture

The admin document preview uses `pdf2pic` to render uploaded PDF/DOC/DOCX pages into PNG files under `storage/images`.
This requires native rendering tools on the backend machine.

On Windows, install GraphicsMagick and Ghostscript, then restart the API. If you use ImageMagick instead of GraphicsMagick, set:

```env
PDF2PIC_GM_CLASS=true
```

For Word files, install LibreOffice or set the converter path:

```env
OFFICE_CONVERTER_COMMAND=C:\Program Files\LibreOffice\program\soffice.exe
```

If an existing document still shows `Images 0` after installing the tools, reprocess it:

```bash
npm run images:reprocess -- <documentId>
```

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
