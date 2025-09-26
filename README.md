# Daily Dashboard

## Getting Started

1. Copy the sample environment file and update secrets:
   ```bash
   cp .env.example .env
   ```
2. Follow the backend and frontend setup sections below to install dependencies and run the apps.

## Backend

### Setup

1. Install dependencies:
   ```bash
   cd backend && npm install
   ```
2. Create a `.env` file in `backend` with:
   ```ini
   MONGODB_URI=<your mongo uri>
   PORT=3000
   JWT_SECRET=<random secret>
   # Allowed origin for CORS
   FRONTEND_ORIGIN=http://localhost:5173
   # New Relic instrumentation (optional locally)
   NEW_RELIC_LICENSE_KEY=<your license key>
   NEW_RELIC_APP_NAME=dailydb-backend
   NEW_RELIC_LOG_LEVEL=info
   NEW_RELIC_NO_CONFIG_FILE=true
   ```
3. Start the server:
   ```bash
   npm start
   ```

### Tech Stack
- Node.js (ESM)
- Express
- Mongoose
- moment-timezone
- Jest
- Supertest

### Environment Variables
- `MONGODB_URI` – MongoDB connection string.
- `PORT` – Port for the HTTP server (default `3000`).
- `JWT_SECRET` – Secret for signing JWT tokens.
- `FRONTEND_ORIGIN` – Allowed origin for CORS requests (default `http://localhost:5173`).
- `NEW_RELIC_LICENSE_KEY` – New Relic account license key (required in staging/production).
- `NEW_RELIC_APP_NAME` / `NEW_RELIC_BACKEND_APP_NAME` – Service name reported to New Relic (default `dailydb-backend`).
- `NEW_RELIC_LOG_LEVEL` – Log verbosity for the agent (default `info`).
- `NEW_RELIC_NO_CONFIG_FILE` – Set to `true` to rely on environment configuration only.

### Dev Scripts
- `npm start` – runs the server
- `npm test` – runs Jest unit tests

### Authentication
Use `POST /login` with `email` and `password` to obtain an access token and a refresh token. Send the access token in the `Authorization: Bearer` header for protected endpoints. The `/tasks/today` route and other future APIs require a valid token.

Tokens may also be refreshed over WebSocket by emitting a `refresh` event with a valid refresh token. The server responds with a new access token which the frontend stores automatically.

To log what you are currently working on, send a `POST /tasks/today` request with `email`, `role`, `teamLead`, `manager` and `activity` in the body. The endpoint stores the sanitized activity in memory and returns a confirmation message.

API documentation is provided using Swagger.

## Frontend

The frontend is a small React application powered by Vite. After logging in it fetches tasks from the backend and displays them.

### Setup
```bash
cd frontend && npm install
npm run dev
```

Open `http://localhost:3000` to view the login page.

The frontend leverages the reusable components under `frontend/components/ui`.
The login screen and the table used to display tasks are built exclusively using
these UI primitives. After signing in you will be redirected to `/dashboard`

where today's tasks appear in a table. Expired access tokens are automatically
refreshed via a Socket.IO `refresh` event using the stored refresh token. If a
socket connection fails with `Unauthorized`, the client transparently requests a
new token, reconnects, and reloads tasks.

Tasks update in real time using a MongoDB change stream. The frontend listens
to `taskCreated` and `taskUpdated` events from the WebSocket. To guard against
any missed messages it also polls the backend every minute. New tasks trigger a
short beep and a browser notification. The view also shows interview reminders:
thirty-five minutes before a scheduled interview a notification bar appears and
the browser plays the beep so the alert is heard even if the tab is in the
background.

### Tech Stack
- React
- TypeScript
- Vite

### Dev Scripts
- `npm run dev` – start the Vite dev server
- `npm run build` – build production assets
- `npm run lint` – run ESLint
- `npm run start` – serve the built bundle with the New Relic agent

### Environment Variables
- `API_URL` – Backend base URL.
- `FRONTEND_PORT` – Port the preview server listens on (default `8180`).
- `NEW_RELIC_LICENSE_KEY` – New Relic account license key (required in staging/production).
- `NEW_RELIC_APP_NAME` / `NEW_RELIC_FRONTEND_APP_NAME` – Service name reported to New Relic (default `dailydb-frontend`).
- `NEW_RELIC_LOG_LEVEL` – Log verbosity for the agent (default `info`).
- `NEW_RELIC_NO_CONFIG_FILE` – Set to `true` to rely on environment configuration only.
- `FRONTEND_HOST` – Host binding for the preview server (default `0.0.0.0`).
- `FRONTEND_OPEN` – Whether to auto-open a browser window (default `false`).

## Docker Compose

Run both services together with New Relic instrumentation:

```bash
docker compose up --build
```

The stack consumes values from `.env` (or `.env.example` as a starting point) and forwards the New Relic environment variables into each container.
