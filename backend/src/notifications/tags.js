import crypto from 'node:crypto';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalizeEmail = (value) => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim().toLowerCase();
  return EMAIL_REGEX.test(trimmed) ? trimmed : '';
};

const normalizeBranch = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim().toUpperCase();
};

const digestList = (values) => {
  const normalized = Array.from(new Set(values.filter(Boolean).sort()));
  if (normalized.length === 0) {
    return '';
  }
  return crypto.createHash('sha256').update(normalized.join('|')).digest('hex');
};

export const TagBuilders = Object.freeze({
  branch: (value) => {
    const branch = normalizeBranch(value);
    return branch ? `branch:${branch}` : null;
  },
  recruiter: (value) => {
    const email = normalizeEmail(value);
    return email ? `recruiter:${email}` : null;
  },
  expert: (value) => {
    const email = normalizeEmail(value);
    return email ? `expert:${email}` : null;
  },
  candidate: (value) => {
    if (!value) return null;
    return `candidate:${String(value)}`;
  },
  composite: (values, prefix) => {
    const digest = digestList(values);
    return digest ? `${prefix}:${digest}` : null;
  }
});

export const deriveTagsFromScope = (scope) => {
  if (!scope || typeof scope !== 'object') {
    return new Set();
  }

  const tags = new Set();
  const type = typeof scope.type === 'string' ? scope.type.trim().toLowerCase() : '';

  switch (type) {
    case 'branch': {
      const tag = TagBuilders.branch(scope.value);
      if (tag) tags.add(tag);
      break;
    }
    case 'hierarchy': {
      const values = Array.isArray(scope.value) ? scope.value : [];
      for (const email of values) {
        const tag = TagBuilders.recruiter(email);
        if (tag) tags.add(tag);
      }
      const composite = TagBuilders.composite(values.map(normalizeEmail), 'hierarchy');
      if (composite) tags.add(composite);
      break;
    }
    case 'expert': {
      const values = Array.isArray(scope.value) ? scope.value : [];
      for (const email of values) {
        const tag = TagBuilders.expert(email);
        if (tag) tags.add(tag);
      }
      const composite = TagBuilders.composite(values.map(normalizeEmail), 'expertGroup');
      if (composite) tags.add(composite);
      break;
    }
    case 'candidate': {
      const tag = TagBuilders.candidate(scope.value);
      if (tag) tags.add(tag);
      break;
    }
    default:
      break;
  }

  return tags;
};

export const deriveTagsFromCandidate = (candidate) => {
  if (!candidate || typeof candidate !== 'object') {
    return new Set();
  }

  const tags = new Set();
  const branchTag = TagBuilders.branch(candidate.branch || candidate.Branch);
  if (branchTag) tags.add(branchTag);

  const recruiterCandidates = [
    candidate.recruiter,
    candidate.recruiterRaw,
    candidate.Recruiter
  ];
  for (const recruiter of recruiterCandidates) {
    const tag = TagBuilders.recruiter(recruiter);
    if (tag) tags.add(tag);
  }

  const expertCandidates = [
    candidate.expert,
    candidate.expertRaw,
    candidate.Expert
  ];
  for (const expert of expertCandidates) {
    const tag = TagBuilders.expert(expert);
    if (tag) tags.add(tag);
  }

  const candidateTag = TagBuilders.candidate(candidate.id || candidate._id);
  if (candidateTag) tags.add(candidateTag);

  return tags;
};
