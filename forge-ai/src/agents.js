import { loadPrompt, callJSON } from './llm.js';

const PROMPTS = {
  author: loadPrompt('1_author.md'),
  jdCritic: loadPrompt('2_jd_critic.md'),
  jdReviser: loadPrompt('3_jd_reviser.md'),
  realismCritic: loadPrompt('4_realism_critic.md'),
  realismReviser: loadPrompt('5_realism_reviser.md'),
};

export async function runAuthor({ jd_text, candidate, traceDir }) {
  const { parsed } = await callJSON({
    agent: 'author',
    prompt: PROMPTS.author,
    vars: { jd_text, candidate_json: candidate },
    temperature: 0.7,
    traceDir,
  });
  return parsed;
}

export async function runJDCritic({ jd_text, resume, traceDir, mustHaves = [] }) {
  const hay = JSON.stringify(resume).toLowerCase();
  const verifiedPresent = mustHaves.filter((k) => hay.includes(String(k).toLowerCase()));
  const verifiedMissing = mustHaves.filter((k) => !hay.includes(String(k).toLowerCase()));
  const { parsed } = await callJSON({
    agent: 'jd_critic',
    prompt: PROMPTS.jdCritic,
    vars: {
      jd_text,
      resume_json: resume,
      verified_present: verifiedPresent,
      verified_missing: verifiedMissing,
    },
    temperature: 0.2,
    traceDir,
  });
  return parsed;
}

export async function runJDReviser({ jd_text, resume, critique, traceDir }) {
  const { parsed } = await callJSON({
    agent: 'jd_reviser',
    prompt: PROMPTS.jdReviser,
    vars: { jd_text, resume_json: resume, jd_critique_json: critique },
    temperature: 0.5,
    traceDir,
  });
  return parsed;
}

export async function runRealismCritic({ resume, candidate, traceDir }) {
  const companies = candidate.companies || [];
  const { parsed } = await callJSON({
    agent: 'realism_critic',
    prompt: PROMPTS.realismCritic,
    vars: { resume_json: resume, candidate_companies_json: companies },
    temperature: 0.2,
    traceDir,
  });
  return parsed;
}

export async function runRealismReviser({ resume, critique, candidate, traceDir }) {
  const companies = candidate.companies || [];
  const { parsed } = await callJSON({
    agent: 'realism_reviser',
    prompt: PROMPTS.realismReviser,
    vars: {
      resume_json: resume,
      realism_critique_json: critique,
      candidate_companies_json: companies,
    },
    temperature: 0.5,
    traceDir,
  });
  return parsed;
}
