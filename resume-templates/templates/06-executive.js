export function render(resume) {
  const { name, title, contact, summary, skills, experience, education, projects, certifications } = resume;

  const contactParts = [
    contact.phone,
    contact.email,
    contact.location,
    contact.linkedin ? `<a href="${contact.linkedin}">${contact.linkedin}</a>` : '',
    contact.github ? `<a href="${contact.github}">${contact.github}</a>` : '',
    contact.website ? `<a href="${contact.website}">${contact.website}</a>` : '',
  ].filter(Boolean).join(' &nbsp;|&nbsp; ');

  const skillsHtml = Object.entries(skills).map(([cat, list]) =>
    `<p><strong>${cat}:</strong> ${list.join(', ')}</p>`
  ).join('\n');

  const expHtml = experience.map(e => `
    <article>
      <h3>${e.role}</h3>
      <p class="company">${e.company}</p>
      <p class="meta">${e.location} &nbsp;|&nbsp; ${e.startDate} - ${e.endDate}</p>
      <ul>${e.bullets.map(b => `<li>${b}</li>`).join('\n')}</ul>
    </article>`
  ).join('\n');

  const eduHtml = education.map(e => `
    <article>
      <h3>${e.degree}</h3>
      <p class="company">${e.school}</p>
      <p class="meta">${e.location} &nbsp;|&nbsp; ${e.startDate} - ${e.endDate}</p>
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
      <p>${certifications.join(' &nbsp;|&nbsp; ')}</p>
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
    color: #1a1a1a;
    font-family: Georgia, "Times New Roman", serif;
    font-size: 11pt;
    line-height: 1.3;
  }
  body { max-width: 7.3in; margin: 0 auto; }
  header { text-align: center; border-bottom: 1pt solid #888; padding-bottom: 6pt; margin-bottom: 10pt; }
  h1 { font-size: 17pt; font-weight: normal; margin: 0 0 2pt; }
  .tagline { font-size: 10.5pt; color: #555; margin: 0 0 3pt; font-variant: small-caps; }
  .meta-contact { font-size: 10pt; color: #555; margin: 0; }
  h2 {
    font-size: 11pt;
    font-weight: bold;
    font-variant: small-caps;
    border-bottom: 0.5pt solid #999;
    padding-bottom: 2pt;
    margin: 10pt 0 5pt;
    color: #333;
  }
  h3 { font-size: 11pt; margin: 6pt 0 1pt; font-weight: bold; }
  .company { font-size: 10.5pt; font-style: italic; color: #444; margin: 0 0 1pt; }
  p, li { margin: 0 0 2pt; }
  ul { margin: 2pt 0 4pt 20pt; padding: 0; list-style: disc; }
  .meta { color: #666; font-size: 10pt; }
  a { color: #1a4fa6; text-decoration: none; }
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
  id: '06-executive',
  label: 'Executive',
  vibe: 'executive',
  density: 'airy',
};
