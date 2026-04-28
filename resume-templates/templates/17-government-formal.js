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
      <p class="meta">Location: ${e.location}</p>
      <p class="meta">Dates of Employment: ${e.startDate} to ${e.endDate}</p>
      <ul>${e.bullets.map(b => `<li>${b}</li>`).join('\n')}</ul>
    </article>`
  ).join('\n');

  const eduHtml = education.map(e => `
    <article>
      <h3>${e.school}</h3>
      <p class="meta">Degree: ${e.degree}</p>
      <p class="meta">Location: ${e.location}</p>
      <p class="meta">Dates Attended: ${e.startDate} to ${e.endDate}</p>
    </article>`
  ).join('\n');

  const projHtml = projects && projects.length ? `
    <section>
      <h2>Projects</h2>
      ${projects.map(p => `
        <article>
          <h3>${p.name}</h3>
          <p class="meta">Technologies Used: ${p.technologies.join(', ')}</p>
          <ul>${p.bullets.map(b => `<li>${b}</li>`).join('\n')}</ul>
        </article>`).join('\n')}
    </section>` : '';

  const certHtml = certifications && certifications.length ? `
    <section>
      <h2>Certifications</h2>
      ${certifications.map(c => `<p>${c}</p>`).join('\n')}
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
    color: #000;
    font-family: "Times New Roman", Times, serif;
    font-size: 11pt;
    line-height: 1.3;
  }
  body { max-width: 7.3in; margin: 0 auto; }
  header {
    text-align: center;
    margin-bottom: 8pt;
    padding-bottom: 6pt;
    border-bottom: 2px solid #000;
  }
  h1 {
    font-size: 16pt;
    margin: 0 0 2pt;
    text-transform: uppercase;
    font-family: Arial, Helvetica, sans-serif;
  }
  .tagline { font-size: 10.5pt; color: #222; margin: 0 0 3pt; }
  .meta-contact { font-size: 10pt; color: #333; margin: 0; }
  h2 {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 11pt;
    text-transform: uppercase;
    border-top: 1.5px solid #000;
    border-bottom: 1px solid #000;
    padding: 2pt 0;
    margin: 10pt 0 5pt;
  }
  h3 {
    font-size: 11pt;
    margin: 6pt 0 1pt;
    font-weight: bold;
    font-family: Arial, Helvetica, sans-serif;
  }
  p, li { margin: 0 0 2pt; }
  ul { margin: 2pt 0 4pt 22pt; padding: 0; list-style: disc; }
  .meta { color: #333; font-size: 10pt; }
  a { color: #000; text-decoration: underline; }
  section { margin-bottom: 2pt; }
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
  id: '17-government-formal',
  label: 'Government Formal',
  vibe: 'USAJobs-style, full dates, formal black-and-white',
  density: 'comfortable',
};
