import crypto from 'node:crypto';
import moment from 'moment-timezone';
import { config } from '../config/index.js';
import { taskModel } from '../models/Task.js';
import { userModel } from '../models/User.js';
import { logger } from '../utils/logger.js';

const TIMEZONE = 'America/New_York';
const PLAN_CACHE_TTL_MS = 15 * 60 * 1000;
const PREVIEW_LIMIT = 50;
const MAX_QUERY_LIMIT = 500;
const ALLOWED_ROLES = new Set(['admin', 'mm', 'mam', 'mtl']);

const COLUMN_DEFINITIONS = {
  subject: { key: 'subject', field: 'subject', label: 'Subject' },
  candidate: { key: 'candidate', field: 'Candidate Name', label: 'Candidate' },
  interviewDate: { key: 'interviewDate', field: 'Date of Interview', label: 'Interview Date' },
  interviewStart: { key: 'interviewStart', field: 'Start Time Of Interview', label: 'Start Time' },
  interviewEnd: { key: 'interviewEnd', field: 'End Time Of Interview', label: 'End Time' },
  round: { key: 'round', field: 'Interview Round', label: 'Round' },
  status: { key: 'status', field: 'status', label: 'Status' },
  assignedExpert: { key: 'assignedExpert', field: 'assignedExpert', label: 'Assigned Expert' },
  assignedTo: { key: 'assignedTo', field: 'assignedTo', label: 'Assigned Email' },
  client: { key: 'client', field: 'End Client', label: 'Client' },
  received: { key: 'received', field: 'receivedDateTime', label: 'Received Date Time' },
  sender: { key: 'sender', field: 'sender', label: 'Sender' },
  cc: { key: 'cc', field: 'cc', label: 'CC' }
};

const DEFAULT_COLUMN_KEYS = ['subject', 'candidate', 'interviewDate', 'round', 'status', 'assignedExpert', 'client', 'received'];

const SORTABLE_FIELDS = new Map([
  ['subject', COLUMN_DEFINITIONS.subject.field],
  ['candidate', COLUMN_DEFINITIONS.candidate.field],
  ['interviewDate', COLUMN_DEFINITIONS.interviewDate.field],
  ['received', COLUMN_DEFINITIONS.received.field],
  ['status', COLUMN_DEFINITIONS.status.field]
]);

const SYSTEM_PROMPT = `You are a planning assistant that translates report requests for the MongoDB collection \
\`taskBody\`. Respond ONLY with JSON that respects the schema below. Never include prose or markdown.\n\nSchema summary (string fields unless noted):\n- subject\n- Candidate Name\n- Date of Interview (format MM/DD/YYYY)\n- Start Time Of Interview\n- End Time Of Interview\n- Interview Round\n- End Client\n- status\n- assignedExpert\n- assignedTo\n- sender\n- cc\n- receivedDateTime (ISO string: YYYY-MM-DDTHH:mm:ssZ)\n\nJSON schema:\n{\n  \\"summary\\": "short plain sentence describing the dataset",\n  \\"filters\\": {\n    \\"dateField\\": "Date of Interview" | "receivedDateTime" | "",\n    \\"from\\": "YYYY-MM-DD" | "",\n    \\"to\\": "YYYY-MM-DD" | "",\n    \\"rounds\\": string[],\n    \\"statuses\\": string[],\n    \\"clients\\": string[],\n    \\"experts\\": string[],\n    \\"recruiters\\": string[],\n    \\"candidates\\": string[],\n    \\"keywords\\": string[]\n  },\n  \\"columns\\": string[],\n  \\"sort\\": {\n    \\"field\\": string,\n    \\"direction\\": "asc" | "desc"\n  },\n  \\"limit\\": number\n}\n\nGuidelines:\n- Dates must be ISO (YYYY-MM-DD). If user omits dates, leave empty strings.\n- Columns must be drawn from the schema summary names or obvious synonyms.\n- Limit must be between 1 and 500 (default 100).\n- Keywords should capture free-text matches (e.g. subject words).\n- Output valid JSON only.`;

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildRegexPattern(value, options = {}) {
  const { anchorStart = false, anchorEnd = false } = options;
  const base = escapeRegex(value.trim()).replace(/\s+/g, '\\s+');
  return `${anchorStart ? '^' : ''}${base}${anchorEnd ? '$' : ''}`;
}

function sanitizeCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') {
    return value.replace(/\s+/g, ' ').trim();
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeCell).filter(Boolean).join(', ');
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

function resolveColumnKey(value) {
  if (typeof value !== 'string') return null;
  const lower = value.trim().toLowerCase();
  if (lower.includes('candidate')) return 'candidate';
  if (lower.includes('subject')) return 'subject';
  if (lower.includes('round')) return 'round';
  if (lower.includes('status')) return 'status';
  if (lower.includes('expert')) return 'assignedExpert';
  if (lower.includes('assigned') || lower.includes('email')) return 'assignedTo';
  if (lower.includes('received')) return 'received';
  if (lower.includes('client')) return 'client';
  if (lower.includes('start')) return 'interviewStart';
  if (lower.includes('end') && !lower.includes('client')) return 'interviewEnd';
  if (lower.includes('date')) return 'interviewDate';
  if (lower.includes('sender')) return 'sender';
  if (lower.includes('cc')) return 'cc';
  return null;
}

// Lightweight Logflare sender for reportAgentService logs
const LOGFLARE_SOURCE = process.env.LOGFLARE_SOURCE || '8ab2f91b-4a77-44a3-95ea-b15faf476a3b';
const LOGFLARE_API_KEY = process.env.LOGFLARE_API_KEY || 'kuvw1feGD8Yw';
const LOGFLARE_URL = `https://api.logflare.app/logs/json?source=${encodeURIComponent(LOGFLARE_SOURCE)}`;

async function sendReportAgentLog(event, details = {}) {
  // Never throw; logging must not affect flow
  try {
    const body = [
      {
        service: 'reportAgentService',
        event,
        timestamp: new Date().toISOString(),
        ...details
      }
    ];

    await fetch(LOGFLARE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-API-KEY': LOGFLARE_API_KEY
      },
      body: JSON.stringify(body)
    }).catch(() => {});
  } catch {}
}

class ReportAgentService {
  constructor() {
    this.planCache = new Map();
  }

  ensureFeatureEnabled() {
    if (config.openai?.profileOnlyMode) {
      const error = new Error('OpenAI usage temporarily limited to candidate profile extraction.');
      error.statusCode = 503;
      throw error;
    }
    if (!config.openai?.apiKey) {
      throw new Error('Report assistant is not configured. Please set OPENAI_API_KEY.');
    }
  }

  ensureRoleAllowed(role) {
    const normalized = (role || '').toLowerCase();
    if (!ALLOWED_ROLES.has(normalized)) {
      throw new Error('This feature is restricted to reporting roles.');
    }
  }

  cleanExpiredPlans() {
    const cutoff = Date.now() - PLAN_CACHE_TTL_MS;
    for (const [token, entry] of this.planCache.entries()) {
      if (entry.createdAt < cutoff) {
        this.planCache.delete(token);
      }
    }
  }

  async callOpenAI(message) {
    try {
      console.log('[ReportAgent] callOpenAI() input message:', JSON.stringify({ message }, null, 2));
      sendReportAgentLog('callOpenAI_input', { message });
    } catch {}
    const { apiKey, baseUrl, model, timeoutMs } = config.openai;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs || 20000);

    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: message }
          ],
          temperature: 1,
          response_format: { type: 'json_object' }
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenAI request failed: ${response.status} ${errText}`);
      }

      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('OpenAI response did not include content.');
      }
      const trimmed = content.trim();
      try {
        const preview = trimmed.length > 1000 ? trimmed.slice(0, 1000) + '…(truncated)' : trimmed;
        console.log('[ReportAgent] callOpenAI() raw content:', preview);
        sendReportAgentLog('callOpenAI_output', { preview });
      } catch {}
      return trimmed;
    } finally {
      clearTimeout(timeout);
    }
  }

  async buildPlan(message) {
    const raw = await this.callOpenAI(message);
    try {
      const plan = JSON.parse(raw);
      try {
        console.log('[ReportAgent] buildPlan() parsed plan:', JSON.stringify(plan, null, 2));
        sendReportAgentLog('buildPlan_parsed', { plan });
      } catch {}
      return plan;
    } catch (error) {
      logger.error('Failed to parse plan JSON', { raw });
      sendReportAgentLog('buildPlan_parse_error', { raw });
      throw new Error('Unable to interpret assistant response. Please rephrase your request.');
    }
  }

  normalizePlan(plan, options = {}) {
    const summary = typeof plan.summary === 'string' && plan.summary.trim()
      ? plan.summary.trim().slice(0, 280)
      : 'Generated report';

    const filters = this.normalizeFilters(plan.filters || {});
    const columns = this.normalizeColumns(plan.columns);
    const sort = this.normalizeSort(plan.sort, columns);
    const limitCandidate = Number.parseInt(plan.limit ?? options.limit ?? 100, 10);
    const limit = Number.isFinite(limitCandidate)
      ? Math.min(Math.max(limitCandidate, 1), MAX_QUERY_LIMIT)
      : 100;

    const normalized = {
      summary,
      filters,
      columns,
      sort,
      limit
    };
    try {
      console.log('[ReportAgent] normalizePlan() result:', JSON.stringify(normalized, null, 2));
      sendReportAgentLog('normalizePlan_result', { plan: normalized });
    } catch {}
    return normalized;
  }

  normalizeFilters(filters) {
    const normalizeArray = (value, limit = 5) => {
      if (!Array.isArray(value)) return [];
      return value
        .map((v) => (typeof v === 'string' ? v.trim() : ''))
        .filter(Boolean)
        .slice(0, limit);
    };

    const coerceDate = (value) => {
      if (typeof value !== 'string') return '';
      const trimmed = value.trim();
      return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : '';
    };

    let dateField = filters.dateField;
    if (typeof dateField === 'string') {
      const df = dateField.trim();
      if (df.toLowerCase().startsWith('received')) {
        dateField = 'receivedDateTime';
      } else if (df.toLowerCase().includes('interview')) {
        dateField = 'Date of Interview';
      } else {
        dateField = '';
      }
    } else {
      dateField = '';
    }

    return {
      dateField,
      from: coerceDate(filters.from),
      to: coerceDate(filters.to),
      rounds: normalizeArray(filters.rounds),
      statuses: normalizeArray(filters.statuses),
      clients: normalizeArray(filters.clients),
      experts: normalizeArray(filters.experts),
      recruiters: normalizeArray(filters.recruiters),
      candidates: normalizeArray(filters.candidates),
      keywords: normalizeArray(filters.keywords, 3)
    };
  }

  normalizeColumns(columns) {
    const keys = Array.isArray(columns)
      ? columns.map(resolveColumnKey).filter(Boolean)
      : [];

    const uniqueKeys = Array.from(new Set(keys.length ? keys : DEFAULT_COLUMN_KEYS));

    return uniqueKeys
      .map((key) => COLUMN_DEFINITIONS[key])
      .filter(Boolean);
  }

  normalizeSort(sort, columns) {
    const defaultField = COLUMN_DEFINITIONS.interviewDate.field;
    if (!sort || typeof sort !== 'object') {
      return { field: defaultField, direction: 1 };
    }

    const columnKey = resolveColumnKey(sort.field);
    const fallback = columnKey ? (COLUMN_DEFINITIONS[columnKey]?.field || defaultField) : defaultField;
    const direction = String(sort.direction || '').toLowerCase() === 'desc' ? -1 : 1;

    return { field: fallback, direction };
  }

  buildRoleFilter(userEmail, userRole, manager, teamEmails) {
    try {
      const match = taskModel.buildDashboardRoleMatch(
        userEmail,
        userRole,
        manager,
        teamEmails
      );
      return match && Object.keys(match).length ? match : {};
    } catch (error) {
      logger.error('Failed to build role filter', { error: error.message, userRole });
      return {};
    }
  }

  buildDateFilter(filters) {
    const { dateField, from, to } = filters;
    if (!dateField) return {};

    const parseIsoToMoment = (value) => {
      if (!value) return null;
      const parsed = moment(value, moment.ISO_8601, true);
      return parsed.isValid() ? parsed.tz(TIMEZONE) : null;
    };

    let startMoment = parseIsoToMoment(from);
    let endMoment = parseIsoToMoment(to);

    if (!startMoment && endMoment) {
      startMoment = endMoment.clone();
    }
    if (!endMoment && startMoment) {
      endMoment = startMoment.clone();
    }

    if (!startMoment || !endMoment) {
      return {};
    }

    if (dateField === 'Date of Interview') {
      const cursor = startMoment.clone().startOf('day');
      const last = endMoment.clone().startOf('day');
      const values = [];
      let safety = 0;
      while (cursor.isSameOrBefore(last, 'day') && safety < 370) {
        values.push(cursor.format('MM/DD/YYYY'));
        cursor.add(1, 'day');
        safety += 1;
      }
      return values.length ? { 'Date of Interview': { $in: values } } : {};
    }

    const startIso = startMoment.clone().startOf('day').toISOString();
    const endIso = endMoment.clone().endOf('day').toISOString();

    try {
      return taskModel.buildDateMatch(dateField, startIso, endIso) || {};
    } catch (error) {
      logger.warn('Failed to build date match; ignoring date filter', {
        error: error.message,
        dateField,
        from,
        to
      });
      return {};
    }
  }

  buildTextFilters(filters) {
    const clauses = [];
    const pushRegexArray = (field, values, options = {}) => {
      if (!values.length) return;
      clauses.push({
        $or: values.map((value) => ({
          [field]: { $regex: buildRegexPattern(value, options), $options: 'i' }
        }))
      });
    };

    if (filters.candidates.length) {
      pushRegexArray('Candidate Name', filters.candidates, { anchorStart: true });
    }
    if (filters.experts.length) {
      pushRegexArray('assignedExpert', filters.experts, { anchorStart: true });
    }
    if (filters.rounds.length) {
      pushRegexArray('Interview Round', filters.rounds, { anchorStart: true, anchorEnd: true });
    }
    if (filters.clients.length) {
      pushRegexArray('End Client', filters.clients, { anchorStart: true });
    }
    if (filters.statuses.length) {
      pushRegexArray('status', filters.statuses, { anchorStart: true, anchorEnd: true });
    }
    if (filters.recruiters.length) {
      const entries = filters.recruiters.map((value) => {
        const pattern = buildRegexPattern(value, { anchorStart: true });
        const rx = { $regex: pattern, $options: 'i' };
        return { $or: [{ sender: rx }, { cc: rx }] };
      });
      clauses.push({ $or: entries });
    }
    if (filters.keywords.length) {
      clauses.push({
        $or: filters.keywords.map((value) => ({
          subject: { $regex: buildRegexPattern(value), $options: 'i' }
        }))
      });
    }

    return clauses;
  }

  buildQuery(user, plan) {
    const teamEmails = userModel.getTeamEmails(
      user.email,
      user.role,
      user.teamLead
    );

    const filters = [];
    const email = (user.email || '').toLowerCase();
    const localPart = email.split('@')[0];
    if (localPart) {
      const baseRegex = escapeRegex(localPart);
      filters.push({
        $or: [
          { cc: { $regex: baseRegex, $options: 'i' } },
          { sender: { $regex: baseRegex, $options: 'i' } }
        ]
      });
    }
    const roleFilter = this.buildRoleFilter(user.email, user.role, user.manager, teamEmails);
    if (Object.keys(roleFilter).length) {
      filters.push(roleFilter);
    }

    const dateFilter = this.buildDateFilter(plan.filters);
    if (Object.keys(dateFilter).length) {
      filters.push(dateFilter);
    }

    const textFilters = this.buildTextFilters(plan.filters);
    if (textFilters.length) {
      filters.push(...textFilters);
    }

    const mongoFilter = filters.length > 1 ? { $and: filters } : (filters[0] || {});

    const projection = {
      body: 0,
      replies: 0
    };

    const sort = { [plan.sort.field]: plan.sort.direction };

    console.log('[ReportAgent] buildQuery() Mongo query built:\n', JSON.stringify({
      filter: mongoFilter,
      projection,
      sort,
      limit: plan.limit,
      columns: plan.columns.map((col) => col.key)
    }, null, 2));
    try {
      sendReportAgentLog('buildQuery_built', {
        filter: mongoFilter,
        projection,
        sort,
        limit: plan.limit,
        columns: plan.columns.map((c) => c.key)
      });
    } catch {}

    return {
      filter: mongoFilter,
      projection,
      sort,
      columns: plan.columns,
      limit: plan.limit
    };
  }

  async fetchDocuments(query, limit) {
    const collection = taskModel.collection;
    const cursor = collection
      .find(query.filter, { projection: query.projection })
      .sort(query.sort)
      .limit(Math.min(limit, MAX_QUERY_LIMIT));

    const docs = await cursor.toArray();
    const total = await collection.countDocuments(query.filter);
    return { docs, total };
  }

  prepareRows(docs, columns) {
    return docs.map((doc) => {
      const row = { id: String(doc._id) };
      columns.forEach((column) => {
        row[column.key] = sanitizeCell(doc[column.field]);
      });
      return row;
    });
  }

  storePlan(user, plan, columns) {
    this.cleanExpiredPlans();
    const token = crypto.randomUUID();
    this.planCache.set(token, {
      plan,
      columns,
      userEmail: (user.email || '').toLowerCase(),
      createdAt: Date.now()
    });
    return token;
  }

  getStoredPlan(user, token) {
    this.cleanExpiredPlans();
    const entry = token ? this.planCache.get(token) : null;
    if (!entry) {
      throw new Error('Report session expired. Please ask again.');
    }
    if (entry.userEmail !== (user.email || '').toLowerCase()) {
      throw new Error('This download token does not belong to the current user.');
    }
    return entry;
  }

  async generateReport(user, message, options = {}) {
    this.ensureFeatureEnabled();
    this.ensureRoleAllowed(user.role);
    try {
      console.log('[ReportAgent] generateReport() input:', JSON.stringify({
        user: { email: user.email, role: user.role },
        message,
        options
      }, null, 2));
      sendReportAgentLog('generateReport_input', {
        user: { email: user.email, role: user.role },
        message,
        options
      });
    } catch {}

    const rawPlan = await this.buildPlan(message);
    const plan = this.normalizePlan(rawPlan, options);
    const query = this.buildQuery(user, plan);
    const previewLimit = Math.min(plan.limit, PREVIEW_LIMIT);
    const { docs, total } = await this.fetchDocuments(query, previewLimit);
    const rows = this.prepareRows(docs, query.columns);
    const token = this.storePlan(user, plan, query.columns);

    try {
      console.log('[ReportAgent] generateReport() output summary:', JSON.stringify({
        token,
        previewCount: rows.length,
        total,
        truncated: total > rows.length
      }, null, 2));
      sendReportAgentLog('generateReport_output', {
        token,
        previewCount: rows.length,
        total,
        truncated: total > rows.length
      });
    } catch {}

    return {
      success: true,
      summary: plan.summary,
      token,
      columns: query.columns.map(({ key, label }) => ({ key, label })),
      rows,
      total,
      previewCount: rows.length,
      truncated: total > rows.length
    };
  }

  async generateDownload(user, token) {
    this.ensureFeatureEnabled();
    this.ensureRoleAllowed(user.role);

    const entry = this.getStoredPlan(user, token);
    const plan = entry.plan;
    const query = this.buildQuery(user, plan);
    const { docs } = await this.fetchDocuments(query, plan.limit);
    const rows = this.prepareRows(docs, query.columns);

    const timestamp = moment().format('YYYYMMDD_HHmm');
    const filename = `report_${timestamp}.json`;

    try {
      console.log('[ReportAgent] generateDownload() prepared:', JSON.stringify({
        user: { email: user.email, role: user.role },
        token,
        filename,
        rowCount: rows.length
      }, null, 2));
      sendReportAgentLog('generateDownload_prepared', {
        user: { email: user.email, role: user.role },
        token,
        filename,
        rowCount: rows.length
      });
    } catch {}

    return {
      success: true,
      filename,
      columns: query.columns.map(({ key, label }) => ({ key, label })),
      rows
    };
  }
}

export const reportAgentService = new ReportAgentService();
