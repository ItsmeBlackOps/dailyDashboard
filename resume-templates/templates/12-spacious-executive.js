export function render(resume) {
  const { name, title, contact, summary, skills, experience, education, projects, certifications } = resume;

  const contactParts = [
    contact.phone,
    contact.email,
    contact.location,
    contact.linkedin ? `<a href="${contact.linkedin}">${contact.linkedin}</a>` : '',
    contact.github ? `<a href="${contact.github}">${contact.github}</a>` : '',
    contact.website ? `<a href="${contact.website}">${contact.website}</a>` : '',
  ].filter(Boolean).join('  |  ');

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
  @page { size: Letter; margin: 0.5in 0.6in; }
  html, body {
    background: #fff;
    color: #111;
    font-family: Calibri, Arial, Helvetica, sans-serif;
    font-size: 10.5pt;
    line-height: 1.3;
  }
  body { max-width: 7.3in; margin: 0 auto; }
  header {
    text-align: center;
    margin-bottom: 10pt;
    padding-bottom: 8pt;
    border-bottom: 2px solid #222;
  }
  h1 {
    font-size: 17pt;
    margin: 0 0 2pt;
    font-weight: 700;
    text-transform: uppercase;
  }
  .tagline { font-size: 10pt; color: #444; margin: 0 0 3pt; font-style: italic; }
  .meta-contact { font-size: 9.5pt; color: #555; margin: 0; }
  h2 {
    font-size: 10.5pt;
    text-transform: uppercase;
    border-bottom: 1.5px solid #222;
    margin: 10pt 0 5pt;
    padding-bottom: 2pt;
    font-weight: 700;
  }
  h3 { font-size: 10.5pt; margin: 6pt 0 2pt; font-weight: 700; }
  p, li { margin: 0 0 2pt; }
  ul { margin: 2pt 0 4pt 20pt; padding: 0; list-style: disc; }
  .meta { color: #555; font-size: 10pt; font-style: italic; }
  a { color: #1a4fa6; text-decoration: none; }
  section { margin-bottom: 6pt; }
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
  id: '12-spacious-executive',
  label: 'Spacious Executive',
  vibe: 'VP-grade, generous whitespace, formal',
  density: 'airy',
};
