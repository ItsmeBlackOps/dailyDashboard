export function render(resume) {
  const { name, title, contact, summary, skills, experience, education, projects, certifications } = resume;

  const contactLines = [
    contact.phone,
    contact.email,
    contact.location,
    contact.linkedin ? `<a href="${contact.linkedin}">${contact.linkedin}</a>` : '',
    contact.github ? `<a href="${contact.github}">${contact.github}</a>` : '',
    contact.website ? `<a href="${contact.website}">${contact.website}</a>` : '',
  ].filter(Boolean).join('<br>');

  const skillsHtml = Object.entries(skills).map(([cat, list]) =>
    `<p><strong>${cat}:</strong> ${list.join(', ')}</p>`
  ).join('\n');

  const expHtml = experience.map(e => `
    <article class="bar-section">
      <h3>${e.company} - ${e.role}</h3>
      <p class="meta">${e.location} &nbsp;|&nbsp; ${e.startDate} - ${e.endDate}</p>
      <ul>${e.bullets.map(b => `<li>${b}</li>`).join('\n')}</ul>
    </article>`
  ).join('\n');

  const eduHtml = education.map(e => `
    <article class="bar-section">
      <h3>${e.school}</h3>
      <p class="meta">${e.degree} &nbsp;|&nbsp; ${e.location} &nbsp;|&nbsp; ${e.startDate} - ${e.endDate}</p>
    </article>`
  ).join('\n');

  const projHtml = projects && projects.length ? `
    <section>
      <h2>Projects</h2>
      ${projects.map(p => `
        <article class="bar-section">
          <h3>${p.name}</h3>
          <p class="meta">${p.technologies.join(', ')}</p>
          <ul>${p.bullets.map(b => `<li>${b}</li>`).join('\n')}</ul>
        </article>`).join('\n')}
    </section>` : '';

  const certHtml = certifications && certifications.length ? `
    <section>
      <h2>Certifications</h2>
      <p class="bar-section">${certifications.join(' &nbsp;|&nbsp; ')}</p>
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
    font-size: 10.5pt;
    line-height: 1.38;
  }
  body { max-width: 7.3in; margin: 0 auto; }

  /* Header with left accent bar via border-left — single-column safe */
  header {
    border-left: 5pt solid #2d6a9f;
    padding-left: 10pt;
    margin-bottom: 12pt;
  }
  h1 { font-size: 18pt; font-weight: 700; margin: 0 0 2pt; color: #1a1a1a; }
  .tagline { font-size: 10pt; color: #2d6a9f; margin: 0 0 4pt; font-weight: 600; }
  .meta-contact { font-size: 9.5pt; color: #555; margin: 0; }

  /* Section headings with left bar using border-left */
  h2 {
    font-size: 11pt;
    font-weight: 700;
    color: #2d6a9f;
    border-left: 4pt solid #2d6a9f;
    padding-left: 8pt;
    margin: 14pt 0 6pt;
    text-transform: uppercase;
    letter-spacing: 0.8pt;
  }

  /* Article blocks with subtle left bar */
  .bar-section {
    border-left: 2pt solid #d0e4f5;
    padding-left: 8pt;
    margin-bottom: 6pt;
  }

  h3 { font-size: 10.5pt; margin: 0 0 1pt; font-weight: 700; }
  p, li { margin: 0 0 3pt; }
  ul { margin: 2pt 0 4pt 18pt; padding: 0; list-style: disc; }
  .meta { color: #666; font-size: 9.5pt; }
  a { color: #2d6a9f; text-decoration: none; }
  section { margin-bottom: 2pt; }
</style>
</head>
<body>
  <header>
    <h1>${name}</h1>
    <p class="tagline">${title}</p>
    <p class="meta-contact">${contactLines.replace(/<br>/g, ' &nbsp;|&nbsp; ')}</p>
  </header>

  <section>
    <h2>Summary</h2>
    <p class="bar-section">${summary}</p>
  </section>

  <section>
    <h2>Experience</h2>
    ${expHtml}
  </section>

  <section>
    <h2>Skills</h2>
    <div class="bar-section">
    ${skillsHtml}
    </div>
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
  id: '09-creative-leftbar',
  label: 'Creative Left Bar',
  vibe: 'modern',
  density: 'comfortable',
};
