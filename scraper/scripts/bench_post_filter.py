"""Profile post_filter on realistic greenhouse-shaped input.

The live greenhouse run stalled for 60+ minutes inside post_filter on
~56K jobs. This script reproduces a realistic mini-workload (500 jobs
with HTML descriptions of plausible size), runs it through post_filter,
and reports per-job latency + cProfile stats so we know what to fix.
"""
from __future__ import annotations

import cProfile
import io
import os
import pstats
import random
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.models import JobPosting
from src.normalizer import post_filter

# Chunk of realistic HTML taken from a typical greenhouse description.
# ~18KB of boilerplate — tags, inline styles, nested lists, repeated
# whitespace. This is what connectors return when they don't strip HTML.
_HTML_BOILERPLATE = """
<div class="description">
  <p>We are hiring a {title} at {company}. Join our team and make an impact.</p>
  <h3>What you'll do</h3>
  <ul>
    <li>Work on interesting problems across multiple domains</li>
    <li>Collaborate with cross-functional teams including product, design, and engineering</li>
    <li>Build, test, and ship new features that delight our customers</li>
    <li>Write clean, maintainable code with solid test coverage</li>
    <li>Mentor junior engineers and contribute to our engineering culture</li>
  </ul>
  <h3>What we're looking for</h3>
  <ul>
    <li>{years}+ years of professional experience building production systems</li>
    <li>Strong proficiency in Python, SQL, and modern data tooling</li>
    <li>Experience with cloud infrastructure (AWS, GCP, or Azure)</li>
    <li>Excellent written and verbal communication skills</li>
    <li>A track record of delivering complex projects on time</li>
  </ul>
  <h3>Nice to have</h3>
  <ul>
    <li>Experience with distributed systems at scale</li>
    <li>Background in the industry or a related field</li>
    <li>Familiarity with modern ML tooling and vector databases</li>
  </ul>
  <h3>Benefits</h3>
  <p>We offer competitive salary, generous equity, unlimited PTO, and 100%
  coverage of medical, dental, and vision insurance. Remote-friendly.
  Annual learning stipend. 401k match up to 6%.</p>
  <p>We are an equal opportunity employer. All qualified applicants will
  receive consideration for employment without regard to race, color,
  religion, sex, sexual orientation, gender identity, national origin,
  disability, veteran status, or any other protected characteristic.</p>
  <p>Our values: integrity, curiosity, excellence, inclusion, impact.</p>
</div>
""".strip()


def _synth_jobs(n: int) -> list[JobPosting]:
    rng = random.Random(42)
    titles = ["Data Analyst", "Senior Data Engineer", "Staff Data Scientist",
              "Principal Analytics Engineer", "Data Analyst II", "Analytics Lead"]
    out = []
    for i in range(n):
        t = rng.choice(titles)
        # Realistic greenhouse sizing — descriptions are often 10-30KB
        # because of inline styles, nested lists, EEOC boilerplate, etc.
        desc = _HTML_BOILERPLATE.format(
            title=t, company=f"Co{i % 23}", years=rng.randint(2, 12)) * 8
        j = JobPosting(
            job_title=t,
            company_name=f"Co{i % 23}",
            location="New York, NY",
            source_platform="greenhouse",
            source_url=f"https://boards.greenhouse.io/fake/jobs/{i}",
            source_job_id=f"GH-{i}",
            full_job_description=desc,
        )
        out.append(j)
    return out


def main() -> int:
    n = 500
    jobs = _synth_jobs(n)
    print(f"[bench] {n} synthetic jobs, description ~{len(jobs[0].full_job_description)} chars each")

    # Warm up regex caches.
    post_filter(jobs[:20])

    # Time a fresh run.
    t0 = time.perf_counter()
    out = post_filter(jobs)
    elapsed = time.perf_counter() - t0
    print(f"[bench] post_filter({n}) -> {len(out)} kept in {elapsed*1000:.1f}ms")
    print(f"[bench] per-job: {elapsed*1000/n:.2f}ms  -> implied throughput for 56K: "
          f"{elapsed * 56_000 / n:.1f}s")

    # Profile.
    pr = cProfile.Profile()
    pr.enable()
    post_filter(jobs)
    pr.disable()

    s = io.StringIO()
    pstats.Stats(pr, stream=s).strip_dirs().sort_stats("cumulative").print_stats(15)
    print("\n[bench] cumulative time (top 15):\n" + s.getvalue())

    return 0


if __name__ == "__main__":
    sys.exit(main())
