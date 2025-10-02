import express from 'express';

const router = express.Router();

// Minimal OpenAPI 3.1 document focusing on task schema changes
const openapi = {
  openapi: '3.1.0',
  info: {
    title: 'Daily Dashboard API',
    version: '2.0.0',
    description: 'HTTP endpoints and shared schemas. Socket events (e.g., getTasksToday) use the same Task schema in responses.\n\nVisibility note: For users with role lead or AM, Today\'s Tasks also include unassigned tasks when the candidate\'s Expert (suggested expert from candidateDetails.Expert) is part of their team. For users with role user or expert, unassigned tasks appear when the candidate\'s Expert equals their email.'
  },
  servers: [
    { url: '/api', description: 'Current server' }
  ],
  paths: {
    '/info': {
      get: {
        summary: 'API info',
        responses: {
          '200': { description: 'Information about the API' }
        }
      }
    },
    '/health': {
      get: {
        summary: 'Health check',
        responses: {
          '200': { description: 'Healthy status' },
          '503': { description: 'Unhealthy status' }
        }
      }
    }
  },
  components: {
    schemas: {
      Task: {
        type: 'object',
        properties: {
          _id: { type: 'string' },
          subject: { type: 'string', nullable: true },
          'Candidate Name': { type: 'string', nullable: true },
          'Date of Interview': { type: 'string', description: 'MM/DD/YYYY', nullable: true },
          'Start Time Of Interview': { type: 'string', nullable: true },
          'End Time Of Interview': { type: 'string', nullable: true },
          'End Client': { type: 'string', nullable: true },
          'Interview Round': { type: 'string', nullable: true },
          status: { type: 'string', nullable: true },
          assignedExpert: { type: 'string', nullable: true },
          assignedEmail: { type: 'string', format: 'email', nullable: true },
          recruiterName: { type: 'string', nullable: true },
          transcription: { type: 'boolean', description: 'Transcript available' },
          // New fields
          candidateExpertDisplay: { type: 'string', nullable: true, description: 'Display name derived from candidateDetails.Expert' },
          suggestions: {
            type: 'array',
            description: 'Suggested assignees based on candidate expert and hierarchy',
            items: { type: 'string' }
          }
        }
      }
    }
  }
};

router.get('/docs/openapi.json', (req, res) => {
  res.status(200).json(openapi);
});

// Human-friendly Swagger UI for the latest OpenAPI document
// Served at: /api/docs (router is mounted under /api)
router.get('/docs', (req, res) => {
  const specUrl = `${req.baseUrl}/docs/openapi.json`;
  const html = `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Daily Dashboard API Docs</title>
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
      <style>
        html, body { margin: 0; height: 100%; background: #0b1020; }
        .swagger-ui .topbar { display: none; }
      </style>
    </head>
    <body>
      <div id="swagger-ui"></div>
      <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
      <script>
        window.onload = function() {
          window.ui = SwaggerUIBundle({
            url: ${JSON.stringify(specUrl)},
            dom_id: '#swagger-ui',
            deepLinking: true,
            persistAuthorization: true,
            presets: [SwaggerUIBundle.presets.apis],
            layout: 'BaseLayout'
          });
        };
      </script>
    </body>
  </html>`;
  res.status(200).type('html').send(html);
});

export default router;
