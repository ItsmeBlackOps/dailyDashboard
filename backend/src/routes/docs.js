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
    },
    '/profile/me': {
      get: {
        summary: 'Get current user profile metadata',
        description: 'Returns the signed-in user profile and role-detail enforcement flags.',
        responses: {
          '200': {
            description: 'Profile metadata',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    profile: {
                      type: 'object',
                      properties: {
                        email: { type: 'string', format: 'email' },
                        displayName: { type: 'string' },
                        jobRole: { type: 'string' },
                        phoneNumber: { type: 'string' },
                        companyName: { type: 'string' },
                        companyUrl: { type: 'string' },
                        requiresRoleDetailSelection: { type: 'boolean' },
                        allowedRoleDetails: {
                          type: 'array',
                          items: { type: 'string', enum: ['DATA', 'DEVELOPER', 'DEVOPS'] }
                        },
                        isComplete: { type: 'boolean' }
                      }
                    }
                  }
                }
              }
            }
          },
          '401': { description: 'Unauthorized' }
        }
      },
      put: {
        summary: 'Update current user profile metadata',
        description: 'For users with role `user`, `jobRole` must be one of DATA, DEVELOPER, DEVOPS.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['displayName', 'jobRole', 'phoneNumber'],
                properties: {
                  displayName: { type: 'string' },
                  jobRole: { type: 'string' },
                  phoneNumber: { type: 'string' }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'Profile updated' },
          '400': { description: 'Validation failed' },
          '401': { description: 'Unauthorized' }
        }
      }
    },
    '/profile/me/role-detail': {
      put: {
        summary: 'Update mandatory role detail for user-role accounts',
        description: 'Updates only `profile.jobRole`. This endpoint is intended for accounts with role `user`.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['jobRole'],
                properties: {
                  jobRole: { type: 'string', enum: ['DATA', 'DEVELOPER', 'DEVOPS'] }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'Role detail updated' },
          '400': { description: 'Validation failed' },
          '401': { description: 'Unauthorized' }
        }
      }
    },
    '/support/interview': {
      post: {
        summary: 'Send interview support request email',
        description: 'Available to recruiter, mlead, mam, and mm roles. Sends an email with candidate details and optional resume/JD attachments to tech leadership.',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                $ref: '#/components/schemas/InterviewSupportPayload'
              }
            }
          }
        },
        responses: {
          '201': {
            description: 'Support request queued',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    message: { type: 'string' }
                  }
                }
              }
            }
          },
          '400': { description: 'Validation failed' },
          '403': { description: 'Insufficient permissions' },
          '409': { description: 'Duplicate interview support subject already exists in tasks' }
        }
      }
    },
    '/support/assessment': {
      post: {
        summary: 'Send assessment support request email',
        description: 'Works like the interview support flow but highlights assessment receipt details, requires resume and assessment info attachments, and supports arbitrary supplemental files.',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                $ref: '#/components/schemas/AssessmentSupportPayload'
              }
            }
          }
        },
        responses: {
          '201': {
            description: 'Assessment support request queued',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    message: { type: 'string' }
                  }
                }
              }
            }
          },
          '400': { description: 'Validation failed' },
          '403': { description: 'Insufficient permissions' }
        }
      }
    },
    '/graph/mail/send': {
      post: {
        summary: 'Send email via Microsoft Graph',
        description: 'Delegated endpoint that forwards the provided payload to Microsoft Graph `me/sendMail`. Requires a Bearer token minted with `Mail.Send` scope.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/GraphMailRequest'
              }
            }
          }
        },
        responses: {
          '202': {
            description: 'Message accepted by Microsoft Graph',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    message: { type: 'string' }
                  }
                }
              }
            }
          },
          '401': { description: 'Missing or invalid bearer token' },
          '503': { description: 'Mail integration not configured' }
        }
      }
    },
    '/tasks/{taskId}/interviewer-questions': {
      post: {
        summary: 'Extract interviewer questions from a transcript',
        description:
          'Available to recruiter, mlead, mam, and mm roles. Requires that the interview transcript (TxAv) exists for the task. Uses the configured OpenAI chat model (defaults to gpt-4.1) to return interviewer-only questions.',
        parameters: [
          {
            name: 'taskId',
            in: 'path',
            required: true,
            schema: { type: 'string' }
          }
        ],
        responses: {
          '200': {
            description: 'Questions extracted successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    questions: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/InterviewerQuestion' }
                    },
                    generatedAt: { type: 'string', format: 'date-time' },
                    rateLimit: {
                      allOf: [{ $ref: '#/components/schemas/RateLimitInfo' }],
                      nullable: true
                    }
                  }
                }
              }
            }
          },
          '400': { description: 'Missing task id or transcript is empty' },
          '403': { description: 'Insufficient permissions' },
          '404': { description: 'Task or transcript not found' },
          '429': { description: 'Rate limit exceeded' },
          '503': { description: 'Feature disabled or upstream service unavailable' }
        }
      }
    },
    '/tasks/{taskId}/transcript-request': {
      post: {
        summary: 'Request transcript access for the current user',
        description:
          'Creates or re-submits a transcript access request for the signed-in user after validating task visibility and transcript availability (TxAv).',
        parameters: [
          {
            name: 'taskId',
            in: 'path',
            required: true,
            schema: { type: 'string' }
          }
        ],
        responses: {
          '200': {
            description: 'Transcript request created or reused',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    message: { type: 'string' },
                    request: { $ref: '#/components/schemas/TranscriptRequest' }
                  }
                }
              }
            }
          },
          '400': { description: 'Task id missing or TxAv unavailable' },
          '401': { description: 'Unauthorized' },
          '403': { description: 'Task not visible to current user' }
        }
      },
      get: {
        summary: 'Get transcript request status for current user on a task',
        parameters: [
          {
            name: 'taskId',
            in: 'path',
            required: true,
            schema: { type: 'string' }
          }
        ],
        responses: {
          '200': {
            description: 'Transcript request status',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    status: { $ref: '#/components/schemas/TranscriptRequestStatus' }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/tasks/transcript-requests/status': {
      post: {
        summary: 'Get transcript request statuses for multiple tasks (current user)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  taskIds: {
                    type: 'array',
                    items: { type: 'string' }
                  }
                }
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Map of task id to transcript request status payload',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    statuses: {
                      type: 'object',
                      additionalProperties: { $ref: '#/components/schemas/TranscriptRequestStatus' }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/tasks/{taskId}/transcript': {
      get: {
        summary: 'Get transcript text for a task',
        description:
          'Admins can always access. Non-admin users can access only after their transcript request is approved.',
        parameters: [
          {
            name: 'taskId',
            in: 'path',
            required: true,
            schema: { type: 'string' }
          }
        ],
        responses: {
          '200': {
            description: 'Transcript returned as plain text',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    title: { type: 'string' },
                    transcriptText: { type: 'string' },
                    generatedAt: { type: 'string', nullable: true }
                  }
                }
              }
            }
          },
          '403': { description: 'Transcript access is not approved for current user' },
          '404': { description: 'Transcript not found' }
        }
      }
    },
    '/transcript-requests': {
      get: {
        summary: 'Admin: list transcript access requests',
        parameters: [
          {
            name: 'status',
            in: 'query',
            required: false,
            schema: { type: 'string', enum: ['pending', 'approved', 'rejected'] }
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 1, maximum: 500 }
          }
        ],
        responses: {
          '200': {
            description: 'Transcript request list',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    requests: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/TranscriptRequest' }
                    }
                  }
                }
              }
            }
          },
          '403': { description: 'Admin role required' }
        }
      }
    },
    '/transcript-requests/{requestId}': {
      put: {
        summary: 'Admin: approve or reject a transcript request',
        parameters: [
          {
            name: 'requestId',
            in: 'path',
            required: true,
            schema: { type: 'string' }
          }
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['action'],
                properties: {
                  action: { type: 'string', enum: ['approve', 'reject'] },
                  note: { type: 'string', nullable: true }
                }
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Request status updated',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    request: { $ref: '#/components/schemas/TranscriptRequest' }
                  }
                }
              }
            }
          },
          '403': { description: 'Admin role required' },
          '404': { description: 'Request not found' }
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
      },
      InterviewerQuestion: {
        type: 'object',
        required: ['question', 'type', 'paraphrased'],
        properties: {
          question: { type: 'string', description: 'Interviewer question text (sanitized)' },
          type: {
            type: 'string',
            enum: ['behavioral', 'technical', 'managerial', 'process', 'culture', 'other']
          },
          paraphrased: { type: 'boolean', description: 'True when the question is paraphrased' }
        }
      },
      RateLimitInfo: {
        type: 'object',
        properties: {
          remaining: { type: 'integer', minimum: 0 },
          resetAt: { type: 'string', format: 'date-time', nullable: true }
        }
      },
      TranscriptRequestStatus: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['none', 'pending', 'approved', 'rejected'] },
          requestedAt: { type: 'string', nullable: true },
          reviewedAt: { type: 'string', nullable: true },
          reviewNote: { type: 'string', nullable: true }
        }
      },
      TranscriptRequest: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          taskId: { type: 'string' },
          taskSubject: { type: 'string' },
          transcriptTitle: { type: 'string' },
          candidateName: { type: 'string' },
          interviewDate: { type: 'string' },
          interviewRound: { type: 'string' },
          requestedBy: { type: 'string', format: 'email' },
          requesterRole: { type: 'string' },
          requestedAt: { type: 'string' },
          status: { type: 'string', enum: ['pending', 'approved', 'rejected'] },
          reviewedBy: { type: 'string', nullable: true },
          reviewedAt: { type: 'string', nullable: true },
          reviewNote: { type: 'string', nullable: true }
        }
      },
      InterviewSupportPayload: {
        type: 'object',
        required: [
          'candidateId',
          'endClient',
          'jobTitle',
          'interviewRound',
          'interviewDateTime',
          'duration',
          'contactNumber'
        ],
        properties: {
          candidateId: { type: 'string', description: 'Candidate identifier from branch candidates list' },
          endClient: { type: 'string', description: 'Client name, title-cased automatically' },
          jobTitle: { type: 'string', description: 'Target job title, title-cased automatically' },
          interviewRound: {
            type: 'string',
            enum: [
              'Screening',
              '1st Round',
              '2nd Round',
              '3rd Round',
              '4th Round',
              '5th Round',
              'Technical Round',
              'Coding Round',
              'Loop Round',
              'Final Round'
            ]
          },
          interviewDateTime: {
            type: 'string',
            format: 'date-time',
            description: 'Interview start time expressed in America/New_York timezone'
          },
          duration: { type: 'string', description: 'Interview duration (e.g., 60 minutes)' },
          contactNumber: { type: 'string', description: 'Recruiter-provided contact number forwarded verbatim' },
          resume: {
            type: 'string',
            format: 'binary',
            description: 'Optional resume attachment (PDF)'
          },
          jobDescription: {
            type: 'string',
            format: 'binary',
            description: 'Optional job description attachment (PDF)'
          }
        }
      },
      AssessmentSupportPayload: {
        type: 'object',
        required: [
          'candidateId',
          'endClient',
          'jobTitle',
          'assessmentReceivedDateTime',
          'resume',
          'assessmentInfo'
        ],
        properties: {
          candidateId: { type: 'string', description: 'Candidate identifier from branch candidates list' },
          endClient: { type: 'string', description: 'Client name, title-cased automatically' },
          jobTitle: { type: 'string', description: 'Target job title, title-cased automatically' },
          assessmentReceivedDateTime: {
            type: 'string',
            format: 'date-time',
            description: 'Assessment received at timestamp normalised to America/New_York timezone'
          },
          assessmentDuration: {
            type: 'string',
            nullable: true,
            description: 'Optional duration detail. When omitted, mark `noDurationMentioned` true.'
          },
          noDurationMentioned: {
            type: 'boolean',
            description: 'Flag to signal that duration information was not supplied'
          },
          additionalInfo: {
            type: 'string',
            description: 'Free-form details rendered ahead of the summary table',
            nullable: true
          },
          jobDescriptionText: {
            type: 'string',
            description: 'Job description text rendered below the summary table',
            nullable: true
          },
          screeningDone: {
            type: 'boolean',
            description: 'When true, the email highlights that screening is complete'
          },
          resume: {
            type: 'string',
            format: 'binary',
            description: 'Required candidate resume attachment'
          },
          assessmentInfo: {
            type: 'string',
            format: 'binary',
            description: 'Required assessment information attachment'
          },
          additionalAttachments: {
            type: 'array',
            items: { type: 'string', format: 'binary' },
            description: 'Optional supporting files (any format)'
          }
        }
      },
      GraphMailRequest: {
        type: 'object',
        required: ['message'],
        properties: {
          message: {
            type: 'object',
            description: 'Microsoft Graph message resource shape (subject, body, recipients, attachments, etc.)'
          },
          saveToSentItems: {
            type: 'boolean',
            description: 'Whether Microsoft Graph should store the sent message in Sent Items (default true)'
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
