export function render(resume) {
  const { name, title, contact, summary, skills, experience, education, projects, certifications } = resume;

  const contactParts = [
    contact.phone,
    contact.email,
    contact.location,
    contact.linkedin ? `<a href="${contact.linkedin}">${contact.linkedin}</a>` : '',
    contact.github ? `<a href="${contact.github}">${contact.github}</a>` : '',
    contact.website ? `<a href="${contact.website}">${contact.website}</a>` : '',
  ].filter(Boolean).join(' | ');

  const skillsHtml = Object.entries(skills).map(([cat, list]) =>
    `<p><strong>${cat}:</strong> ${list.join(', ')}</p>`
  ).join('\n');

  const expHtml = experience.map(e => `
    <article>
      <h3>${e.company} - ${e.role}</h3>
      <p class="meta">${e.location} | ${e.startDate} to ${e.endDate}</p>
      <ul>${e.bullets.map(b => `<li>${b}</li>`).join('\n')}</ul>
    </article>`
  ).join('\n');

  const eduHtml = education.map(e => `
    <article>
      <h3>${e.school}</h3>
      <p class="meta">${e.degree}, ${e.location} | ${e.startDate} to ${e.endDate}</p>
    </article>`
  ).join('\n');

  const projHtml = projects && projects.length ? `
    <section>
      <h2>Projects</h2>
      ${projects.map(p => `
        <article>
          <h3>${p.name}</h3>
          <p class="meta">Technologies: ${p.technologies.join(', ')}</p>
          <ul>${p.bullets.map(b => `<li>${b}</li>`).join('\n')}</ul>
        </article>`).join('\n')}
    </section>` : '';

  const certHtml = certifications && certifications.length ? `
    <section>
      <h2>Certifications</h2>
      <p>${certifications.join(', ')}</p>
    </section>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${name} - Resume</title>
<style>
  @page { size: Letter; margin: 0.4in 0.45in; }
  html, body {
    background: #fff;
    color: #111;
    font-family: Calibri, Arial, Helvetica, sans-serif;
    font-size: 11pt;
    line-height: 1.3;
  }
  body { max-width: 7.3in; margin: 0 auto; }
  header { margin-bottom: 6pt; padding-bottom: 4pt; border-bottom: 2px solid #1a1a1a; }
  h1 { font-size: 16pt; margin: 0 0 1pt; font-weight: 900; }
  .tagline { font-size: 10.5pt; color: #333; margin: 0 0 2pt; font-weight: 600; }
  .meta-contact { font-size: 9pt; color: #555; margin: 0; }
  .summary-block {
    background: #1a1a1a;
    color: #fff;
    padding: 6pt 10pt;
    margin: 6pt 0 8pt;
    font-size: 10.5pt;
    font-weight: 600;
    line-height: 1.35;
  }
  .summary-block .summary-label {
    font-size: 8pt;
    text-transform: uppercase;
    color: #aaa;
    display: block;
    margin-bottom: 2pt;
  }
  h2 {
    font-size: 11pt;
    text-transform: uppercase;
    border-bottom: 2px solid #1a1a1a;
    margin: 10pt 0 4pt;
    padding-bottom: 2pt;
    font-weight: 700;
  }
  h3 { font-size: 11pt; margin: 5pt 0 1pt; font-weight: bold; }
  p, li { margin: 0 0 2pt; }
  ul { margin: 1pt 0 4pt 18pt; padding: 0; list-style: disc; }
  .meta { color: #555; font-size: 10pt; }
  a { color: #4a90d9; text-decoration: none; }
  section { margin-bottom: 2pt; }
</style>
</head>
<body>
  <header>
    <h1>${name}</h1>
    <p class="tagline">${title}</p>
    <p class="meta-contact">${contactParts}</p>
  </header>

  <div class="summary-block">
    <span class="summary-label">Summary</span>
    ${summary}
  </div>

  <section>
    <h2>Experience</h2>
    ${expHtml}
  </section>

  <section>
    <h2>Skills</h2>
    ${skillsHtml}
  </section>

  ${projHtml}

  <section>
    <h2>Education</h2>
    ${eduHtml}
  </section>

  ${certHtml}
</body>
</html>`;
}

export const meta = {
  id: '14-summary-first-bold',
  label: 'Summary First Bold',
  vibe: 'impact-focused, bold summary block, high contrast',
  density: 'comfortable',
};
