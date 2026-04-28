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

  // Condensed: max 4 bullets per role
  const expHtml = experience.map(e => {
    const bullets = e.bullets.slice(0, 4);
    return `
    <article>
      <h3>${e.company} - ${e.role}</h3>
      <p class="meta">${e.location} | ${e.startDate} to ${e.endDate}</p>
      <ul>${bullets.map(b => `<li>${b}</li>`).join('\n')}</ul>
    </article>`;
  }).join('\n');

  const eduHtml = education.map(e => `
    <p><strong>${e.school}</strong> - ${e.degree} | ${e.startDate} to ${e.endDate}</p>`
  ).join('\n');

  const projHtml = projects && projects.length ? `
    <section>
      <h2>Projects</h2>
      ${projects.slice(0, 2).map(p => `
        <p><strong>${p.name}</strong> (${p.technologies.slice(0, 4).join(', ')}): ${p.bullets[0] || ''}</p>`).join('\n')}
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
  @page { size: Letter; margin: 0.45in 0.55in; }
  html, body {
    background: #fff;
    color: #111;
    font-family: Arial, Helvetica, sans-serif;
    font-size: 9.5pt;
    line-height: 1.25;
  }
  body { max-width: 7.4in; margin: 0 auto; }
  header {
    margin-bottom: 6pt;
    padding-bottom: 4pt;
    border-bottom: 2px solid #222;
  }
  h1 { font-size: 18pt; margin: 0 0 2pt; }
  .tagline { font-size: 9.5pt; color: #444; margin: 0 0 2pt; }
  .meta-contact { font-size: 8.5pt; color: #555; margin: 0; }
  h2 {
    font-size: 10pt;
    text-transform: uppercase;
    letter-spacing: 0.8pt;
    border-bottom: 1px solid #555;
    margin: 8pt 0 3pt;
    padding-bottom: 1pt;
  }
  h3 { font-size: 9.5pt; margin: 5pt 0 1pt; font-weight: bold; }
  p, li { margin: 0 0 2pt; }
  ul { margin: 1pt 0 3pt 15pt; padding: 0; list-style: disc; }
  .meta { color: #555; font-size: 8.5pt; margin-bottom: 2pt; }
  a { color: #1a4fa6; text-decoration: none; }
  section { margin-bottom: 1pt; }
  article { margin-bottom: 4pt; }
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
    <h2>Skills</h2>
    ${skillsHtml}
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
  id: '16-1page-condensed',
  label: '1-Page Condensed',
  vibe: 'strict single-page, top 4 bullets per role, early-career',
  density: 'compact',
};
