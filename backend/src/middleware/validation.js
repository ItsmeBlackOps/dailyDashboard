/**
 * Enhanced Validation Middleware
 *
 * Comprehensive validation system with schema-based validation,
 * sanitization, and detailed error reporting.
 */

import { logger } from '../utils/logger.js';

/**
 * Validation schema definitions
 */
const validationSchemas = {
  email: {
    type: 'string',
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    required: true,
    maxLength: 254,
    message: 'Must be a valid email address'
  },
  password: {
    type: 'string',
    required: true,
    minLength: 6,
    maxLength: 128,
    message: 'Must be at least 6 characters long'
  },
  role: {
    type: 'string',
    enum: ['admin', 'lead', 'user', 'AM', 'MM', 'MAM', 'mlead', 'mtl', 'MTL'],
    message: 'Must be a valid role'
  },
  date: {
    type: 'date',
    message: 'Must be a valid date'
  },
  string: {
    type: 'string',
    maxLength: 1000,
    message: 'Must be a valid string'
  },
  number: {
    type: 'number',
    message: 'Must be a valid number'
  },
  boolean: {
    type: 'boolean',
    message: 'Must be a boolean value'
  }
};

/**
 * Validation error class
 */
class ValidationError extends Error {
  constructor(message, field, value) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
    this.value = value;
    this.statusCode = 400;
  }
}

/**
 * Validate single field against schema
 */
function validateField(value, schema, fieldName) {
  const errors = [];

  // Check if required
  if (schema.required && (value === undefined || value === null || value === '')) {
    errors.push(`${fieldName} is required`);
    return errors;
  }

  // Skip validation if field is optional and empty
  if (!schema.required && (value === undefined || value === null || value === '')) {
    return errors;
  }

  // Type validation
  switch (schema.type) {
    case 'string':
      if (typeof value !== 'string') {
        errors.push(`${fieldName} must be a string`);
        break;
      }

      if (schema.minLength && value.length < schema.minLength) {
        errors.push(`${fieldName} must be at least ${schema.minLength} characters long`);
      }

      if (schema.maxLength && value.length > schema.maxLength) {
        errors.push(`${fieldName} must be no more than ${schema.maxLength} characters long`);
      }

      if (schema.pattern && !schema.pattern.test(value)) {
        errors.push(schema.message || `${fieldName} format is invalid`);
      }

      if (schema.enum && !schema.enum.includes(value)) {
        errors.push(`${fieldName} must be one of: ${schema.enum.join(', ')}`);
      }

      break;

    case 'number':
      const num = Number(value);
      if (isNaN(num)) {
        errors.push(`${fieldName} must be a valid number`);
        break;
      }

      if (schema.min && num < schema.min) {
        errors.push(`${fieldName} must be at least ${schema.min}`);
      }

      if (schema.max && num > schema.max) {
        errors.push(`${fieldName} must be no more than ${schema.max}`);
      }

      break;

    case 'boolean':
      if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
        errors.push(`${fieldName} must be a boolean value`);
      }
      break;

    case 'date':
      const date = new Date(value);
      if (isNaN(date.getTime())) {
        errors.push(`${fieldName} must be a valid date`);
      }
      break;

    case 'array':
      if (!Array.isArray(value)) {
        errors.push(`${fieldName} must be an array`);
        break;
      }

      if (schema.minItems && value.length < schema.minItems) {
        errors.push(`${fieldName} must contain at least ${schema.minItems} items`);
      }

      if (schema.maxItems && value.length > schema.maxItems) {
        errors.push(`${fieldName} must contain no more than ${schema.maxItems} items`);
      }

      break;

    case 'object':
      if (typeof value !== 'object' || Array.isArray(value)) {
        errors.push(`${fieldName} must be an object`);
      }
      break;
  }

  return errors;
}

/**
 * Sanitize input value
 */
function sanitizeValue(value, schema) {
  if (value === undefined || value === null) {
    return value;
  }

  switch (schema.type) {
    case 'string':
      let sanitized = String(value).trim();

      // Remove dangerous characters
      if (schema.removeDangerous !== false) {
        sanitized = sanitized
          .replace(/[<>]/g, '') // Remove angle brackets
          .replace(/javascript:/gi, '') // Remove javascript protocol
          .replace(/data:/gi, '') // Remove data protocol
          .replace(/on\w+=/gi, ''); // Remove event handlers
      }

      return sanitized;

    case 'number':
      return Number(value);

    case 'boolean':
      if (typeof value === 'boolean') return value;
      if (typeof value === 'string') {
        const lower = value.toLowerCase();
        return lower === 'true' || lower === '1';
      }
      return Boolean(value);

    case 'date':
      return new Date(value);

    default:
      return value;
  }
}

/**
 * Validate object against schema
 */
function validateObject(obj, schemaFields) {
  const errors = [];
  const sanitized = {};

  for (const [fieldName, schema] of Object.entries(schemaFields)) {
    const value = obj[fieldName];
    const fieldErrors = validateField(value, schema, fieldName);

    if (fieldErrors.length > 0) {
      errors.push(...fieldErrors);
    } else {
      // Sanitize valid values
      sanitized[fieldName] = sanitizeValue(value, schema);
    }
  }

  // Add any fields not in schema (but sanitize strings)
  for (const [key, value] of Object.entries(obj)) {
    if (!schemaFields[key]) {
      if (typeof value === 'string') {
        sanitized[key] = sanitizeValue(value, { type: 'string' });
      } else {
        sanitized[key] = value;
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    sanitized
  };
}

/**
 * Create validation middleware
 */
export function validationMiddleware(schema) {
  return (req, res, next) => {
    const validationLogger = req.logger || logger.child('validation');

    try {
      const { isValid, errors, sanitized } = validateObject(req.body, schema);

      if (!isValid) {
        validationLogger.warn('Validation failed', {
          errors,
          url: req.url,
          method: req.method,
          body: req.body
        });

        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors,
          timestamp: new Date().toISOString()
        });
      }

      // Replace request body with sanitized version
      req.body = sanitized;
      req.validationPassed = true;

      next();

    } catch (error) {
      validationLogger.error('Validation middleware error', {
        error: error.message,
        stack: error.stack,
        url: req.url
      });

      return res.status(500).json({
        success: false,
        error: 'Internal validation error',
        timestamp: new Date().toISOString()
      });
    }
  };
}

/**
 * Enhanced validation functions
 */
export const validateEmail = (email) => {
  const result = validateField(email, validationSchemas.email, 'email');
  return result.length === 0;
};

export const validatePassword = (password) => {
  const result = validateField(password, validationSchemas.password, 'password');
  return result.length === 0;
};

export const validateRole = (role) => {
  const result = validateField(role, validationSchemas.role, 'role');
  return result.length === 0;
};

/**
 * Specific validation middleware functions
 */
export const validateLoginData = validationMiddleware({
  email: validationSchemas.email,
  password: validationSchemas.password
});

export const validateSocketLogin = (data) => {
  const { email, password } = data;
  const errors = [];

  if (!email) {
    errors.push('Email is required');
  } else if (!validateEmail(email)) {
    errors.push('Invalid email format');
  }

  if (!password) {
    errors.push('Password is required');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

export const validateRefreshToken = (req, res, next) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    logger.warn('Refresh token validation failed - missing token');
    return res.status(400).json({
      success: false,
      error: 'Refresh token is required'
    });
  }

  next();
};

export const validateSocketRefreshToken = (data) => {
  const { refreshToken } = data;

  if (!refreshToken) {
    return {
      isValid: false,
      errors: ['Refresh token is required']
    };
  }

  return {
    isValid: true,
    errors: []
  };
};

export const validateUserCreation = (req, res, next) => {
  const { email, password, role, teamLead, manager } = req.body;
  const errors = [];

  if (!email) {
    errors.push('Email is required');
  } else if (!validateEmail(email)) {
    errors.push('Invalid email format');
  }

  if (!password) {
    errors.push('Password is required');
  } else if (!validatePassword(password)) {
    errors.push('Password must be at least 6 characters long');
  }

  if (role && !validateRole(role)) {
    errors.push('Invalid role specified');
  }

  if (teamLead && typeof teamLead !== 'string') {
    errors.push('Team lead must be a string');
  }

  if (manager && typeof manager !== 'string') {
    errors.push('Manager must be a string');
  }

  if (errors.length > 0) {
    logger.warn('User creation validation failed', { errors, email });
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors
    });
  }

  next();
};

export const validateTasksQuery = (data) => {
  const { tab, targetDate } = data;
  const errors = [];

  // Tab is optional, but if provided should be a string
  if (tab !== undefined && typeof tab !== 'string') {
    errors.push('Tab must be a string');
  }

  if (targetDate !== undefined) {
    if (typeof targetDate !== 'string') {
      errors.push('targetDate must be a string');
    } else {
      const parsed = new Date(targetDate);
      if (isNaN(parsed.getTime())) {
        errors.push('targetDate must be a valid date string');
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

export const validateDashboardQuery = (data) => {
  const { start, end, range, dateField, upcoming } = data;
  const errors = [];

  if (range !== undefined) {
    const allowedRanges = ['day', 'week', 'month', 'custom'];
    if (typeof range !== 'string' || !allowedRanges.includes(range)) {
      errors.push('Invalid range specified');
    }
  }

  if (dateField !== undefined && typeof dateField !== 'string') {
    errors.push('dateField must be a string');
  }

  if (upcoming !== undefined && typeof upcoming !== 'boolean') {
    errors.push('upcoming must be a boolean');
  }

  if (start !== undefined) {
    const startDate = new Date(start);
    if (isNaN(startDate.getTime())) {
      errors.push('Invalid start date format');
    }
  }

  if (end !== undefined) {
    const endDate = new Date(end);
    if (isNaN(endDate.getTime())) {
      errors.push('Invalid end date format');
    }
  }

  if (start && end) {
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (startDate >= endDate) {
      errors.push('Start date must be before end date');
    }
  }

  if (range === 'custom' && (!start || !end)) {
    errors.push('Custom range requires start and end dates');
  }

  // If upcoming=true is set, we don't require range/start/end; it overrides any range
  // Validate that upcoming is not combined with an invalid range value
  if (upcoming === true && range !== undefined && !['day', 'week', 'month', 'custom'].includes(range)) {
    errors.push('Invalid range specified');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

export const validateCandidateQuery = (data = {}) => {
  const { limit, search } = data;
  const errors = [];

  if (limit !== undefined) {
    const parsedLimit = Number(limit);
    if (!Number.isFinite(parsedLimit) || !Number.isInteger(parsedLimit)) {
      errors.push('limit must be an integer');
    } else if (parsedLimit < 1 || parsedLimit > 500) {
      errors.push('limit must be between 1 and 500');
    }
  }

  if (search !== undefined && typeof search !== 'string') {
    errors.push('search must be a string');
  }

  if (typeof search === 'string' && search.trim().length > 120) {
    errors.push('search must be 120 characters or fewer');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

export const sanitizeInput = (input) => {
  if (typeof input === 'string') {
    return input.trim();
  }
  return input;
};

export const sanitizeObject = (obj) => {
  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    sanitized[key] = sanitizeInput(value);
  }
  return sanitized;
};

export const validateCandidateUpdate = (data = {}) => {
  const errors = [];
  const payload = {};

  if (!data || typeof data !== 'object') {
    errors.push('payload must be an object');
    return { isValid: false, errors, payload };
  }

  const { candidateId, name, email, technology, recruiter, contact, expert, branch, resumeLink } = data;

  if (!candidateId || typeof candidateId !== 'string' || candidateId.trim().length === 0) {
    errors.push('candidateId is required');
  } else {
    payload.candidateId = candidateId.trim();
  }

  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      errors.push('name must be a non-empty string');
    } else if (name.trim().length > 200) {
      errors.push('name must be 200 characters or fewer');
    } else {
      payload.name = name.trim();
    }
  }

  if (email !== undefined) {
    if (typeof email !== 'string' || email.trim().length === 0) {
      errors.push('email must be a non-empty string');
    } else if (!validationSchemas.email.pattern.test(email.trim().toLowerCase())) {
      errors.push('email must be a valid email address');
    } else {
      payload.email = email.trim();
    }
  }

  if (technology !== undefined) {
    if (typeof technology !== 'string' || technology.trim().length === 0) {
      errors.push('technology must be a non-empty string');
    } else if (technology.trim().length > 200) {
      errors.push('technology must be 200 characters or fewer');
    } else {
      payload.technology = technology.trim();
    }
  }

  if (recruiter !== undefined) {
    if (typeof recruiter !== 'string' || recruiter.trim().length === 0) {
      errors.push('recruiter must be a non-empty string');
    } else if (recruiter.trim().length > 200) {
      errors.push('recruiter must be 200 characters or fewer');
    } else {
      payload.recruiter = recruiter.trim();
    }
  }

  if (branch !== undefined) {
    if (typeof branch !== 'string' || branch.trim().length === 0) {
      errors.push('branch must be a non-empty string');
    } else if (branch.trim().length > 50) {
      errors.push('branch must be 50 characters or fewer');
    } else {
      payload.branch = branch.trim().toUpperCase();
    }
  }

  if (contact !== undefined) {
    if (typeof contact !== 'string' && typeof contact !== 'number') {
      errors.push('contact must be a string or number');
    } else {
      payload.contact = contact.toString().trim();
    }
  }

  if (expert !== undefined) {
    if (typeof expert !== 'string' || expert.trim().length === 0) {
      errors.push('expert must be a non-empty string');
    } else if (expert.trim().length > 254) {
      errors.push('expert must be 254 characters or fewer');
    } else if (!validationSchemas.email.pattern.test(expert.trim().toLowerCase())) {
      errors.push('expert must be a valid email address');
    } else {
      payload.expert = expert.trim();
    }
  }

  if (resumeLink !== undefined) {
    if (typeof resumeLink !== 'string' || resumeLink.trim().length === 0) {
      errors.push('resumeLink must be a non-empty string');
    } else if (!/^https:\/\/[^\s]+$/i.test(resumeLink.trim())) {
      errors.push('resumeLink must be a valid HTTPS URL');
    } else {
      payload.resumeLink = resumeLink.trim();
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    payload
  };
};

export const validateCandidateCreate = (data = {}) => {
  const errors = [];
  const payload = {};

  if (!data || typeof data !== 'object') {
    errors.push('payload must be an object');
    return { isValid: false, errors, payload };
  }

  const { name, email, technology, recruiter, contact, branch, resumeLink } = data;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    errors.push('name is required');
  } else if (name.trim().length > 200) {
    errors.push('name must be 200 characters or fewer');
  } else {
    payload.name = name.trim();
  }

  if (!email || typeof email !== 'string' || email.trim().length === 0) {
    errors.push('email is required');
  } else if (!validationSchemas.email.pattern.test(email.trim().toLowerCase())) {
    errors.push('email must be a valid email address');
  } else {
    payload.email = email.trim();
  }

  if (!technology || typeof technology !== 'string' || technology.trim().length === 0) {
    errors.push('technology is required');
  } else if (technology.trim().length > 200) {
    errors.push('technology must be 200 characters or fewer');
  } else {
    payload.technology = technology.trim();
  }

  if (!recruiter || typeof recruiter !== 'string' || recruiter.trim().length === 0) {
    errors.push('recruiter is required');
  } else if (!validationSchemas.email.pattern.test(recruiter.trim().toLowerCase())) {
    errors.push('recruiter must be a valid email address');
  } else {
    payload.recruiter = recruiter.trim();
  }

  if (!branch || typeof branch !== 'string' || branch.trim().length === 0) {
    errors.push('branch is required');
  } else if (branch.trim().length > 50) {
    errors.push('branch must be 50 characters or fewer');
  } else {
    payload.branch = branch.trim().toUpperCase();
  }

  if (contact !== undefined) {
    payload.contact = contact.toString().trim();
  }

  if (!resumeLink || typeof resumeLink !== 'string' || resumeLink.trim().length === 0) {
    errors.push('resumeLink is required');
  } else if (!/^https:\/\/[^\s]+$/i.test(resumeLink.trim())) {
    errors.push('resumeLink must be a valid HTTPS URL');
  } else {
    payload.resumeLink = resumeLink.trim();
  }

  return {
    isValid: errors.length === 0,
    errors,
    payload
  };
};

export const validateAssignExpert = (data = {}) => {
  const errors = [];
  const payload = {};

  const { candidateId, expert } = data || {};

  if (!candidateId || typeof candidateId !== 'string' || candidateId.trim().length === 0) {
    errors.push('candidateId is required');
  } else {
    payload.candidateId = candidateId.trim();
  }

  if (!expert || typeof expert !== 'string' || expert.trim().length === 0) {
    errors.push('expert is required');
  } else if (!validationSchemas.email.pattern.test(expert.trim().toLowerCase())) {
    errors.push('expert must be a valid email address');
  } else {
    payload.expert = expert.trim();
  }

  return {
    isValid: errors.length === 0,
    errors,
    payload
  };
};

export const validateResumeUnderstanding = (data = {}) => {
  const errors = [];
  const payload = {};

  const { candidateId, status } = data || {};

  if (!candidateId || typeof candidateId !== 'string' || candidateId.trim().length === 0) {
    errors.push('candidateId is required');
  } else {
    payload.candidateId = candidateId.trim();
  }

  if (!status || typeof status !== 'string') {
    errors.push('status is required');
  } else {
    const normalized = status.trim().toLowerCase();
    if (!['pending', 'done'].includes(normalized)) {
      errors.push('status must be pending or done');
    } else {
      payload.status = normalized;
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    payload
  };
};
export const validateCandidateStatusUpdate = (data = {}) => {
  const errors = [];
  const payload = {};
  const allowedStatuses = ['Active', 'Hold', 'Low Priority', 'Backout', 'Placement Offer'];

  const { candidateId, status } = data || {};

  if (!candidateId || typeof candidateId !== 'string' || candidateId.trim().length === 0) {
    errors.push('candidateId is required');
  } else {
    payload.candidateId = candidateId.trim();
  }

  if (!status || typeof status !== 'string' || status.trim().length === 0) {
    errors.push('status is required');
  } else if (!allowedStatuses.includes(status.trim())) {
    errors.push(`status must be one of: ${allowedStatuses.join(', ')}`);
  } else {
    payload.status = status.trim();
  }

  return {
    isValid: errors.length === 0,
    errors,
    payload
  };
};
export const validateResumeQueueQuery = (data = {}) => {
  const errors = [];
  const payload = {};

  const { limit, status } = data || {};

  if (limit !== undefined) {
    const parsedLimit = Number(limit);
    if (!Number.isFinite(parsedLimit) || !Number.isInteger(parsedLimit)) {
      errors.push('limit must be an integer');
    } else if (parsedLimit < 1 || parsedLimit > 500) {
      errors.push('limit must be between 1 and 500');
    } else {
      payload.limit = parsedLimit;
    }
  }

  if (status !== undefined) {
    if (typeof status !== 'string') {
      errors.push('status must be a string');
    } else {
      const normalizedStatus = status.trim().toLowerCase();
      if (!['pending', 'done'].includes(normalizedStatus)) {
        errors.push('status must be pending or done');
      } else {
        payload.status = normalizedStatus;
      }
    }
  } else {
    payload.status = 'pending';
  }

  return {
    isValid: errors.length === 0,
    errors,
    payload
  };
};

export const validateResumeCountQuery = (data = {}) => {
  const errors = [];
  const payload = {};

  const { status } = data || {};

  if (status !== undefined) {
    if (typeof status !== 'string') {
      errors.push('status must be a string');
    } else {
      const normalizedStatus = status.trim().toLowerCase();
      if (!['pending', 'done'].includes(normalizedStatus)) {
        errors.push('status must be pending or done');
      } else {
        payload.status = normalizedStatus;
      }
    }
  } else {
    payload.status = 'pending';
  }

  return {
    isValid: errors.length === 0,
    errors,
    payload
  };
};
