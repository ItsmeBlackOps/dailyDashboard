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
    color: #1a1a1a;
    /* Body text in Georgia (serif) for classic feel */
    font-family: Georgia, "Times New Roman", serif;
    font-size: 10.5pt;
    line-height: 1.3;
  }
  body { max-width: 7.3in; margin: 0 auto; }

  /* Name and header in Helvetica/sans for modern feel */
  header {
    border-bottom: 2px solid #222;
    padding-bottom: 6pt;
    margin-bottom: 8pt;
  }
  h1 {
    font-family: Helvetica, Arial, sans-serif;
    font-size: 17pt;
    font-weight: 700;
    margin: 0 0 1pt;
    color: #111;
  }
  .tagline {
    font-family: Helvetica, Arial, sans-serif;
    font-size: 10pt;
    color: #555;
    margin: 0 0 2pt;
    font-weight: 400;
  }
  .meta-contact {
    font-family: Helvetica, Arial, sans-serif;
    font-size: 9.5pt;
    color: #555;
    margin: 0;
  }

  /* Section headings: Helvetica small-caps style, overline accent */
  h2 {
    font-family: Helvetica, Arial, sans-serif;
    font-size: 10.5pt;
    font-weight: 700;
    font-variant: small-caps;
    border-top: 1px solid #bbb;
    border-bottom: 1px solid #bbb;
    padding: 2pt 0;
    margin: 10pt 0 5pt;
    color: #222;
  }

  /* Article headings: sans for company/role */
  h3 {
    font-family: Helvetica, Arial, sans-serif;
    font-size: 10.5pt;
    margin: 5pt 0 1pt;
    font-weight: 700;
  }

  /* Body text (bullets, paragraphs) inherits Georgia */
  p, li { margin: 0 0 2pt; }
  ul { margin: 1pt 0 4pt 18pt; padding: 0; list-style: disc; }
  .meta {
    font-family: Helvetica, Arial, sans-serif;
    color: #666;
    font-size: 9.5pt;
  }
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
  id: '10-hybrid-modern-classic',
  label: 'Hybrid Modern Classic',
  vibe: 'hybrid',
  density: 'comfortable',
};
