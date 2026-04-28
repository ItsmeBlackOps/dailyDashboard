export function render(resume) {
  const { name, title, contact, summary, skills, experience, education, projects, certifications } = resume;

  const contactParts = [
    contact.phone,
    contact.email,
    contact.location,
    contact.linkedin ? `<a href="${contact.linkedin}">${contact.linkedin}</a>` : '',
    contact.github ? `<a href="${contact.github}">${contact.github}</a>` : '',
    contact.website ? `<a href="${contact.website}">${contact.website}</a>` : '',
  ].filter(Boolean).join('  &nbsp;&nbsp;  ');

  const skillsHtml = Object.entries(skills).map(([cat, list]) =>
    `<p><strong>${cat}:</strong> ${list.join(', ')}</p>`
  ).join('\n');

  const expHtml = experience.map(e => `
    <article>
      <h3>${e.company}</h3>
      <p class="role">${e.role}</p>
      <p class="meta">${e.location} &nbsp;&nbsp; ${e.startDate} - ${e.endDate}</p>
      <ul>${e.bullets.map(b => `<li>${b}</li>`).join('\n')}</ul>
    </article>`
  ).join('\n');

  const eduHtml = education.map(e => `
    <article>
      <h3>${e.school}</h3>
      <p class="role">${e.degree}</p>
      <p class="meta">${e.location} &nbsp;&nbsp; ${e.startDate} - ${e.endDate}</p>
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
      <p>${certifications.join(' &nbsp;&nbsp; ')}</p>
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
    color: #1a1a1a;
    font-family: Helvetica, Arial, sans-serif;
    font-size: 10.5pt;
    line-height: 1.3;
  }
  body { max-width: 7.3in; margin: 0 auto; }
  header { margin-bottom: 10pt; }
  h1 {
    font-size: 17pt;
    font-weight: 300;
    margin: 0 0 2pt;
    text-transform: uppercase;
  }
  .tagline { font-size: 10pt; color: #777; margin: 0 0 3pt; font-weight: 400; }
  .meta-contact { font-size: 9pt; color: #666; margin: 0; }
  h2 {
    font-size: 9pt;
    font-weight: 700;
    text-transform: uppercase;
    color: #888;
    margin: 10pt 0 5pt;
    border: none;
  }
  h3 { font-size: 10.5pt; margin: 6pt 0 1pt; font-weight: 600; }
  .role { font-size: 10pt; color: #555; margin: 0 0 1pt; }
  p, li { margin: 0 0 2pt; }
  ul { margin: 2pt 0 4pt 18pt; padding: 0; list-style: disc; }
  .meta { color: #888; font-size: 9pt; }
  a { color: #444; text-decoration: none; }
  section { margin-bottom: 4pt; }
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
  id: '03-modern-minimal',
  label: 'Modern Minimal',
  vibe: 'modern',
  density: 'airy',
};
