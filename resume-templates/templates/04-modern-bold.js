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
      <p class="meta">${e.location} | ${e.startDate} - ${e.endDate}</p>
      <ul>${e.bullets.map(b => `<li>${b}</li>`).join('\n')}</ul>
    </article>`
  ).join('\n');

  const eduHtml = education.map(e => `
    <article>
      <h3>${e.school} - ${e.degree}</h3>
      <p class="meta">${e.location} | ${e.startDate} - ${e.endDate}</p>
    </article>`
  ).join('\n');

  const projHtml = projects && projects.length ? `
    <section>
      <h2>Projects</h2>
      ${projects.map(p => `
        <article>
          <h3>${p.name}</h3>
          <p class="meta">${p.technologies.join(', ')}</p>
          <ul>${p.bullets.map(b => `<li>${b}</li>`).join('\n')}</ul>
        </article>`).join('\n')}
    </section>` : '';

  const certHtml = certifications && certifications.length ? `
    <section>
      <h2>Certifications</h2>
      <p>${certifications.join(' | ')}</p>
    </section>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${name} - Resume</title>
<style>
  @page { size: Letter; margin: 0.5in 0.6in; }
  html, body {
    background: #fff;
    color: #111;
    font-family: Helvetica, Arial, sans-serif;
    font-size: 10pt;
    line-height: 1.3;
  }
  body { max-width: 7.3in; margin: 0 auto; }
  header {
    background: #111;
    color: #fff;
    padding: 7pt 10pt;
    margin-bottom: 8pt;
  }
  h1 {
    font-size: 17pt;
    font-weight: 900;
    margin: 0 0 1pt;
    color: #fff;
  }
  .tagline { font-size: 9.5pt; color: #ccc; margin: 0 0 2pt; font-weight: 400; }
  .meta-contact { font-size: 9pt; color: #bbb; margin: 0; }
  .meta-contact a { color: #aac4ff; }
  h2 {
    font-size: 10.5pt;
    font-weight: 900;
    text-transform: uppercase;
    background: #f0f0f0;
    padding: 2pt 6pt;
    margin: 8pt 0 4pt;
    border-left: 4pt solid #111;
  }
  h3 { font-size: 10pt; margin: 5pt 0 1pt; font-weight: 700; }
  p, li { margin: 0 0 2pt; }
  ul { margin: 1pt 0 4pt 18pt; padding: 0; list-style: disc; }
  .meta { color: #555; font-size: 9pt; }
  a { color: #1a4fa6; text-decoration: none; }
  section { margin-bottom: 2pt; }
</style>
</head>
<body>
  <header>
    <h1>${name}</h1>
    <p class="tagline">${title}</p>
    <p class="meta-contact">${contactParts}</p>
  </header>

  <section>
    <h2>Summary</h2>
    <p>${summary}</p>
  </section>

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
  id: '04-modern-bold',
  label: 'Modern Bold',
  vibe: 'modern',
  density: 'compact',
};
