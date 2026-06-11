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

`POST /api/documents/upload` expects multipart form data:

- `pdf`: the PDF file
- `title`: optional document title

Admin users can upload PDFs. Students can ask questions and view document results.
