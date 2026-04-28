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
    font-family: Arial, Helvetica, sans-serif;
    font-size: 11pt;
    line-height: 1.3;
  }
  body { max-width: 7.3in; margin: 0 auto; }
  header { margin-bottom: 6pt; padding-bottom: 4pt; border-bottom: 2px solid #333; }
  h1 { font-size: 16pt; margin: 0 0 1pt; }
  .tagline { font-size: 10.5pt; color: #444; margin: 0 0 2pt; }
  .meta-contact { font-size: 9pt; color: #555; margin: 0; }
  h2 {
    font-size: 11pt;
    text-transform: uppercase;
    background: #f2f2f2;
    padding: 2pt 5pt;
    margin: 9pt 0 4pt;
    border-left: 4px solid #333;
  }
  h3 { font-size: 11pt; margin: 5pt 0 1pt; font-weight: bold; }
  p, li { margin: 0 0 2pt; }
  ul { margin: 1pt 0 4pt 18pt; padding: 0; list-style: disc; }
  .meta { color: #555; font-size: 10pt; }
  a { color: #1a4fa6; text-decoration: none; }
  section { margin-bottom: 2pt; }
  .skills-block { padding: 3pt 6pt; margin-bottom: 4pt; }
</style>
</head>
<body>
  <header>
    <h1>${name}</h1>
    <p class="tagline">${title}</p>
    <p class="meta-contact">${contactParts}</p>
  </header>

  <section>
    <h2>Skills</h2>
    <div class="skills-block">
      ${skillsHtml}
    </div>
  </section>

  <section>
    <h2>Summary</h2>
    <p>${summary}</p>
  </section>

  <section>
    <h2>Experience</h2>
    ${expHtml}
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
  id: '13-skills-first',
  label: 'Skills First',
  vibe: 'keyword-dense, skills above summary for senior tech roles',
  density: 'compact',
};
