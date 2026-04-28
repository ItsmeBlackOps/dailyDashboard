export function render(resume) {
  const { name, title, contact, summary, skills, experience, education, projects, certifications } = resume;

  const contactParts = [
    contact.phone,
    contact.email,
    contact.location,
    contact.linkedin ? `<a href="${contact.linkedin}">${contact.linkedin}</a>` : '',
    contact.github ? `<a href="${contact.github}">${contact.github}</a>` : '',
    contact.website ? `<a href="${contact.website}">${contact.website}</a>` : '',
  ].filter(Boolean).join(' :: ');

  const skillsHtml = Object.entries(skills).map(([cat, list]) =>
    `<p><strong>${cat.toUpperCase()}:</strong> ${list.join(' | ')}</p>`
  ).join('\n');

  const expHtml = experience.map(e => `
    <article>
      <h3>${e.company} / ${e.role}</h3>
      <p class="meta">${e.location.toUpperCase()} :: ${e.startDate.toUpperCase()} - ${e.endDate.toUpperCase()}</p>
      <ul>${e.bullets.map(b => `<li>${b}</li>`).join('\n')}</ul>
    </article>`
  ).join('\n');

  const eduHtml = education.map(e => `
    <article>
      <h3>${e.school} / ${e.degree}</h3>
      <p class="meta">${e.location.toUpperCase()} :: ${e.startDate.toUpperCase()} - ${e.endDate.toUpperCase()}</p>
    </article>`
  ).join('\n');

  const projHtml = projects && projects.length ? `
    <section>
      <h2>Projects</h2>
      ${projects.map(p => `
        <article>
          <h3>${p.name}</h3>
          <p class="meta">STACK: ${p.technologies.join(' | ')}</p>
          <ul>${p.bullets.map(b => `<li>${b}</li>`).join('\n')}</ul>
        </article>`).join('\n')}
    </section>` : '';

  const certHtml = certifications && certifications.length ? `
    <section>
      <h2>Certifications</h2>
      <p>${certifications.join(' :: ')}</p>
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
    font-family: "Courier New", "Lucida Console", monospace;
    font-size: 10pt;
    line-height: 1.35;
  }
  body { max-width: 7.3in; margin: 0 auto; }
  header {
    border: 2px solid #111;
    padding: 6pt 8pt;
    margin-bottom: 8pt;
  }
  h1 {
    font-size: 16pt;
    font-weight: bold;
    margin: 0 0 1pt;
    text-transform: uppercase;
  }
  .tagline { font-size: 9pt; color: #555; margin: 0 0 2pt; text-transform: uppercase; }
  .meta-contact { font-size: 9pt; color: #444; margin: 0; }
  h2 {
    font-size: 10pt;
    font-weight: bold;
    text-transform: uppercase;
    margin: 9pt 0 3pt;
    border-bottom: 1px dashed #555;
    padding-bottom: 2pt;
  }
  h3 { font-size: 10pt; margin: 5pt 0 1pt; font-weight: bold; }
  p, li { margin: 0 0 2pt; font-size: 10pt; }
  ul { margin: 1pt 0 3pt 18pt; padding: 0; list-style: disc; }
  .meta { color: #666; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.5pt; }
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
  id: '05-tech-monochrome',
  label: 'Tech Monochrome',
  vibe: 'tech',
  density: 'compact',
};
