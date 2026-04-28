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
      <hr class="section-rule">
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
      <hr class="section-rule">
      <p>${certifications.join(', ')}</p>
    </section>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${name} - Resume</title>
<style>
  @page { size: Letter; margin: 0.55in 0.65in; }
  html, body {
    background: #fff;
    color: #111;
    font-family: Georgia, "Times New Roman", serif;
    font-size: 10.5pt;
    line-height: 1.4;
  }
  body { max-width: 7.2in; margin: 0 auto; }
  header {
    margin-bottom: 10pt;
    padding-bottom: 8pt;
    border-bottom: 1px solid #bbb;
  }
  h1 {
    font-size: 18pt;
    margin: 0 0 3pt;
    font-family: Arial, Helvetica, sans-serif;
    font-variant: small-caps;
    letter-spacing: 1.5pt;
  }
  .tagline {
    font-size: 10pt;
    color: #444;
    margin: 0 0 4pt;
    font-family: Arial, Helvetica, sans-serif;
    font-variant: small-caps;
    letter-spacing: 0.5pt;
  }
  .meta-contact { font-size: 9pt; color: #555; margin: 0; }
  h2 {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 11pt;
    text-transform: uppercase;
    letter-spacing: 2pt;
    margin: 14pt 0 2pt;
    padding-bottom: 0;
    font-variant: small-caps;
  }
  hr.section-rule {
    border: none;
    border-top: 1px solid #888;
    margin: 2pt 0 6pt;
  }
  h3 {
    font-size: 10.5pt;
    margin: 7pt 0 2pt;
    font-weight: bold;
    font-family: Arial, Helvetica, sans-serif;
  }
  p, li { margin: 0 0 3pt; }
  ul { margin: 2pt 0 6pt 18pt; padding: 0; list-style: disc; }
  .meta { color: #555; font-size: 9.5pt; font-style: italic; }
  a { color: #1a4fa6; text-decoration: none; }
  section { margin-bottom: 2pt; }
  article { margin-bottom: 5pt; }
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
    <hr class="section-rule">
    <p>${summary}</p>
  </section>

  <section>
    <h2>Experience</h2>
    <hr class="section-rule">
    ${expHtml}
  </section>

  <section>
    <h2>Skills</h2>
    <hr class="section-rule">
    ${skillsHtml}
  </section>

  ${projHtml}

  <section>
    <h2>Education</h2>
    <hr class="section-rule">
    ${eduHtml}
  </section>

  ${certHtml}
</body>
</html>`;
}

export const meta = {
  id: '19-consulting-deck',
  label: 'Consulting Deck',
  vibe: 'section dividers as horizontal rules, small-caps headings, formal-modern',
  density: 'comfortable',
};
