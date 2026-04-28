"""Company-slug discovery layer.

Purpose: find hundreds / thousands of tenant slugs per source so our daily
scraper can hit a wide surface area without hardcoding every company.

Strategies (each is a plugin):
  * seed_lists   — embedded, hand-curated list of well-known real tenants
  * jobpulse     — AST-parsed lists from the cloned JobPulse repo
  * github       — free public lists on GitHub (user adds URLs in .env)
  * apify        — optional Apify actors (requires APIFY_TOKEN)
  * sitemap      — vendor sitemaps where they exist (e.g. Lever)

Each strategy returns slugs; the orchestrator unions, de-dupes,
optionally validates via the public API (HEAD/GET 200), and writes the
final list to data/companies/<source>.txt.
"""
