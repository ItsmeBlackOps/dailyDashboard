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
      <h3>${e.company} - ${e.role} <span class="meta-inline">| ${e.location} | ${e.startDate} - ${e.endDate}</span></h3>
      <ul>${e.bullets.map(b => `<li>${b}</li>`).join('\n')}</ul>
    </article>`
  ).join('\n');

  const eduHtml = education.map(e => `
    <p><strong>${e.school}</strong> - ${e.degree} <span class="meta-inline">| ${e.location} | ${e.startDate} - ${e.endDate}</span></p>`
  ).join('\n');

  const projHtml = projects && projects.length ? `
    <section>
      <h2>Projects</h2>
      ${projects.map(p => `
        <article>
          <h3>${p.name} <span class="meta-inline">| ${p.technologies.join(', ')}</span></h3>
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
  @page { size: Letter; margin: 0.4in 0.45in; }
  html, body {
    background: #fff;
    color: #111;
    font-family: Arial, Helvetica, sans-serif;
    font-size: 10.5pt;
    line-height: 1.2;
  }
  body { max-width: 7.4in; margin: 0 auto; }
  header { margin-bottom: 6pt; border-bottom: 1px solid #333; padding-bottom: 4pt; }
  h1 { font-size: 18pt; margin: 0 0 1pt; font-weight: bold; }
  .tagline { font-size: 10pt; color: #444; margin: 0 0 2pt; }
  .meta-contact { font-size: 9pt; color: #555; margin: 0; }
  h2 {
    font-size: 10.5pt;
    font-weight: bold;
    text-transform: uppercase;
    letter-spacing: 1pt;
    border-bottom: 1px solid #ccc;
    padding-bottom: 1pt;
    margin: 7pt 0 3pt;
  }
  h3 { font-size: 10.5pt; margin: 5pt 0 1pt; font-weight: bold; }
  .meta-inline { font-weight: normal; font-size: 9pt; color: #555; }
  p, li { margin: 0 0 1pt; font-size: 10.5pt; }
  ul { margin: 1pt 0 3pt 16pt; padding: 0; list-style: disc; }
  .meta { color: #555; font-size: 9pt; }
  a { color: #1a4fa6; text-decoration: none; }
  section { margin-bottom: 0; }
  article { margin-bottom: 3pt; }
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
  id: '07-compact-dense',
  label: 'Compact Dense',
  vibe: 'classic',
  density: 'compact',
};
