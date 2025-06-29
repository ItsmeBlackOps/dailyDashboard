# Daily Dashboard

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
refreshed via a Socket.IO `refresh` event using the stored refresh token. If
refreshing fails the user is returned to the sign-in page.

The tasks view shows interview reminders. Thirty-five minutes before a scheduled
interview a notification bar appears and the browser plays a short beep. The
notification also triggers the browser's Notification API so the alert is heard
even if the tab is in the background.

### Tech Stack
- React
- TypeScript
- Vite

### Dev Scripts
- `npm run dev` – start the Vite dev server
- `npm run build` – build production assets
- `npm run lint` – run ESLint

