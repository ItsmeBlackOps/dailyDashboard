"""Embedded, hand-curated seed lists of well-known real tenants.

These are verified public job-board slugs across major U.S. employers. They
exist so the project works out-of-the-box with hundreds of boards, even
before the user runs any discovery step.

We intentionally over-cover: a few slugs may 404 over time — the validator
in orchestrator.py prunes dead ones.
"""
from __future__ import annotations

GREENHOUSE_SEED: tuple[str, ...] = (
    # payments / fintech
    "stripe", "plaid", "ramp", "brex", "chime", "affirm", "mercury", "robinhood",
    "coinbase", "bitgo", "gemini", "anchorage", "circle", "faire", "checkr",
    "pagerduty", "addepar", "blend", "carta", "upstart", "roofstock", "tala",
    "creditkarma", "dave", "fundingcircle", "greenlight", "sofi", "varo",
    # marketplaces / consumer
    "airbnb", "doordash", "doordashusa", "instacart", "lyft", "uber", "opendoor",
    "gopuff", "turo", "offerup", "mercari", "reddit", "pinterest", "etsy",
    "shopify", "wayfair", "faire", "thumbtack", "grailed", "depop",
    # infra / dev tools
    "gitlab", "github", "hashicorp", "cloudflare", "fastly", "mongodb", "databricks",
    "snowflake", "elastic", "sentry", "airtable", "figma", "notion", "linear",
    "vercel", "netlify", "retool", "postman", "twilio", "segment", "amplitude",
    "datadoghq", "datadog", "docker", "dockerinc", "circleci", "launchdarkly",
    # ai / ml
    "openai", "anthropic", "xai", "scaleai", "huggingface", "together", "cohere",
    "databricks", "runwayml", "replicate", "pinecone", "weaviate", "chroma",
    # saas / productivity
    "atlassian", "asana", "dropbox", "box", "slack", "calendly", "docusign",
    "zoom", "zapier", "monday", "clickup", "front", "intercom", "gong", "gongio",
    "mixpanel", "heap", "productboard", "pendo", "confluent", "okta", "auth0",
    "snyk", "lacework", "rapid7", "onelogin", "crowdstrike", "sentinelone",
    # hr / fintech back office
    "rippling", "gusto", "justworks", "deel", "remote", "envoy", "bamboohr",
    "workday", "lattice", "culture-amp", "cultureamp", "pave", "severl",
    # commerce / brands
    "samsara", "flexport", "convoy", "flock", "warbyparker", "allbirds",
    "gopuff", "peloton", "whoop", "ouraring", "oura", "hims", "hims-and-hers",
    "ro", "ruggable", "awayhq", "glossier", "fashionnova", "levis", "nike",
    # media / content
    "netflix", "spotify", "soundcloud", "soundxyz", "twitch", "voxmedia",
    "nytimes", "newsela", "hellofresh", "chewy", "fulfillment", "twitch",
    # gaming / entertainment
    "roblox", "unity3d", "discord", "nianticlabs", "niantic", "singularity6",
    "scopely", "epicgames", "devolverdigital", "riotgames",
    # health / bio
    "benchling", "hims", "ro", "oscar", "cityblock", "calm", "headway", "alma",
    "tempus", "zocdoc", "hinge", "flatiron", "helix", "color", "23andme",
    "ginkgobioworks", "natera", "recursion", "nuna",
    # logistics / industrial
    "flexport", "samsara", "opendoor", "convoy", "shipbob", "rapidsos",
    "verkada", "scale", "anduril", "skydio", "zipline", "shieldai",
    # misc high-profile
    "palantir", "cloudflare", "discord", "duolingo", "khanacademy", "coursera",
    "udemy", "cameo", "pachyderm", "snorkelai", "mongodb", "redis", "timescale",
    "cockroachlabs", "neon4tech", "fivetran", "airbyte", "dbt-labs", "dbtlabs",
    # reality check entries sometimes needed across seasons
    "toast", "toasttab", "foursquare", "squareup", "block", "dwolla",
    "workos", "auth0", "okta", "pingidentity", "yubico",
)

LEVER_SEED: tuple[str, ...] = (
    "netflix", "spotify", "shopify", "kraken", "attentive", "cruise", "lyft",
    "cockroachlabs", "ziprecruiter", "wealthsimple", "affirm", "plaid",
    "palantir", "kraken", "verily", "toyota-research", "angellist", "gitlab",
    "instabase", "webflow", "canva", "discord", "curri", "notion",
    "benchling", "whoop", "peloton", "gong", "intercom", "monte-carlo",
    "montecarlodata", "arcadia", "substack", "toast", "deel", "remote",
    "ramp", "attentivemobile", "hopper", "retool", "replit", "klaviyo",
    "khan-academy", "rover", "wise", "revolut", "nerdwallet", "carsdotcom",
    "trueaccord", "instabase", "scale", "handshake", "outschool", "pachyderm",
    "scaleai", "samsara", "airtable", "asana", "notion", "figma", "loom",
    "lattice", "ashbyhq", "ashby", "vercel", "linear", "stainlessapi",
    "modal", "anthropic", "writer", "perplexity", "harvey", "glean",
)

ASHBY_SEED: tuple[str, ...] = (
    "linear", "vercel", "openai", "anthropic", "posthog", "ramp", "mercury",
    "dagster", "baseten", "together", "runwayml", "replicate", "huggingface",
    "pinecone", "modal", "webflow", "loom", "character", "characterai",
    "retool", "cresta", "cohere", "glean", "harvey", "perplexity", "writer",
    "scaleai", "notion", "figma", "supabase", "resend", "planetscale",
    "neon", "clerk", "stainlessapi", "langchain", "weaviate", "chroma",
    "deel", "rippling", "mercury", "ashbyhq", "ashby", "whoop", "whop",
    "suno", "midjourney", "replit", "lovable", "v0", "attentive", "attentivemobile",
    "coda", "linear", "dust", "granola", "browserbase", "hume", "eleven",
    "elevenlabs", "fintail", "copilotkit", "cursor", "windsurf", "zed",
)

SMARTRECRUITERS_SEED: tuple[str, ...] = (
    "Square", "Bosch", "Visa", "Ubisoft", "McDonalds", "Ikea", "Wayfair",
    "Atlassian", "Electronic-Arts", "LinkedIn", "Pinterest", "Twitter",
    "Spotify", "MCDONALDSCORPORATION", "UBISOFT1", "Salesforce1",
)

WORKABLE_SEED: tuple[str, ...] = (
    "workable", "ada", "tactic", "sardine", "together", "karat", "matterport",
    "deepgram", "overjet", "firstvet", "flywheel", "rezi", "cesium",
    "doxel", "plusai", "nexla", "hivebrite", "workatastartup",
)

# Workday tenants are "tenant:wdN:site" triples. The site segment is the
# external career-site name from the public URL and is case-sensitive.
# Discover more from: https://{tenant}.wd{N}.myworkdayjobs.com/en-US/{site}
WORKDAY_SEED: tuple[str, ...] = (
    "nvidia:wd5:NVIDIAExternalCareerSite",
    "salesforce:wd12:External_Career_Site",
    "workday:wd5:Workday",
    "intuit:wd12:IntuitCareers",
    "cisco:wd5:Cisco",
    "apple:wd1:AppleJobs",
    "netapp:wd1:NetApp",
    "medtronic:wd5:MedtronicCareers",
    "walmart:wd5:WalmartExternal",
    "target:wd5:targetcareers",
    "bestbuy:wd1:BBYCareerSite",
    "unitedhealth:wd5:uhg",
    "dell:wd1:External",
    "servicenow:wd1:ServiceNowCareers",
    "autodesk:wd1:Ext",
)


# iCIMS tenants are the subdomain segment of careers-{X}.icims.com.
#
# iCIMS deploys an aggressive WAF that geo/bot-gates the sitemap endpoint
# ("Your IP address is not on a trusted network"). From many cloud egress
# IPs EVERY tenant returns 403/405 regardless of URL, so running with the
# default seed just spams the log with 15 warnings per cycle.
#
# We therefore ship an EMPTY default and let operators opt-in explicitly via
# the ICIMS_COMPANIES env var after they've confirmed their egress IP is
# whitelisted (typically US residential or known search-engine ranges).
#
# Known-public tenants for reference, if your egress IP is trusted:
#   pepsico, marriott, wellsfargo, aig, kpmg, aflac, delta, kellogg,
#   unitedrentals, loreal, thermofisher, johnsoncontrols, textronhr,
#   honeywellsafety, assurant
ICIMS_SEED: tuple[str, ...] = ()


# Recruitee — European roots but now global; picks up many US SaaS + SMB.
RECRUITEE_SEED: tuple[str, ...] = (
    "catawiki", "bynder", "mollie", "frontify", "remote", "bolt",
    "beat", "picnic", "mews", "kraken", "veriff", "doubledutch",
    "hellofresh", "worldoftanks", "ohpen", "typeform",
)

# Personio — still skews DACH but has a growing US presence.
PERSONIO_SEED: tuple[str, ...] = (
    "personio", "sennder", "n26", "celonis", "taxfix", "raisin",
    "moovit", "deepl", "nexiga", "forto", "infinitas-learning",
    "infinitas", "kinsta", "sumup", "choco",
)

# Jobvite — "slug" for modern feed, "legacy:{code}" for classic XML.
JOBVITE_SEED: tuple[str, ...] = (
    "premise", "intercom-careers", "bombas", "dnanexus", "ingenico",
    "infogain", "coupa", "harness", "ziprecruiter", "autodesk",
    "kongregate", "lookout", "thumbtack", "pindrop", "paloaltonetworks",
)

# JazzHR / applytojob.com
JAZZHR_SEED: tuple[str, ...] = (
    "whop", "underdogfantasy", "ovou", "revive", "jkfenner",
    "alltruists", "mavensecurities", "rms-us", "coinme",
    "soundcommerce", "tribe", "atlasrtx", "coreweave",
)

# Eightfold — major enterprise deployments where it fronts Workday/SF.
EIGHTFOLD_SEED: tuple[str, ...] = (
    "jobs-capitalone", "capitalone", "bayer", "chevron", "vmware",
    "bnymellon", "dolbylabs", "dolby", "amd", "citi",
    "cisco", "micron", "salesforce", "fiserv", "raytheon",
)

# Rippling ATS — startups + mid-market US companies.
RIPPLING_SEED: tuple[str, ...] = (
    "rippling", "superorder", "scribd", "brex", "warp",
    "bezel", "tango", "meter", "harvey", "together-ai",
    "cortex", "lunch", "numeric",
)

# Teamtailor — strong in EU but growing US SMB tenant base.
TEAMTAILOR_SEED: tuple[str, ...] = (
    "recordia", "voltaware", "vulcan", "chainguard", "neo4j",
    "volvocars", "tibber", "quantumblack", "kry", "truecaller",
)

# SAP SuccessFactors — prefix "N:" to pin the shard, otherwise 1..10 is
# probed. Most large SAP customers are pinned to `career10` (DC-10) but
# older customers can be on any shard.
SUCCESSFACTORS_SEED: tuple[str, ...] = (
    # Documented public SF customers (IDs from public career-page URLs)
    "10:daimlertruck", "10:pepsico", "10:enterpriseholdings",
    "10:bankofamerica", "10:lowes", "10:marriott", "10:fedex",
    "10:unitedhealthgroup", "10:humana", "10:saiglobal",
    "10:exxonmobilcorp", "10:chevron", "10:astrazeneca",
)

# BambooHR — subdomain slug of {X}.bamboohr.com. Common for mid-market US
# employers; the /careers/list JSON endpoint is public. Slugs below are
# verified to serve the live JSON feed (no auth required).
BAMBOOHR_SEED: tuple[str, ...] = (
    "bamboohr", "webflow", "circleci", "fullstaq",
    "zapier", "doist", "gitprime", "scalar",
    "octopusdeploy", "plainconcepts", "axios", "basecamp",
    "trello", "buffer", "help-scout", "helpscout",
    "teachable", "podia", "ghost", "envato", "ingram",
)

# Paylocity — tenant UUIDs. Empty by default because UUIDs aren't
# guessable; operators populate via `PAYLOCITY_COMPANIES` env CSV or
# the employer-discovery pipeline auto-fills `data/companies/paylocity.txt`
# by extracting iframe UUIDs from career pages.
PAYLOCITY_SEED: tuple[str, ...] = ()

# UKG UltiPro — composite ``TENANT/UUID`` (optionally ``SHARD|TENANT/UUID``).
# Empty for the same reason Paylocity is empty — tenants + UUIDs aren't
# guessable. The employer-discovery loop auto-fills ``data/companies/ukg.txt``
# by crawling real UltiPro-hosted careers URLs.
UKG_SEED: tuple[str, ...] = ()

# Oracle Recruiting Cloud (Fusion HCM) — composite ``host/region/site``.
# Tenants are per-customer Oracle cloud pods with opaque host identifiers
# (e.g. ``ecqj``) and region codes (e.g. ``us2``, ``em3``). Because the
# host + region combo is not guessable without touching a customer's
# careers page first, the discovery pipeline populates this via the
# employer-domain crawl → ``data/companies/oracle_rc.txt``.
ORACLE_RC_SEED: tuple[str, ...] = ()

# Dayforce (Ceridian) — bare tenant slug (``acme``) or ``SHARD:tenant``
# (e.g. ``us58:mycompany``). Empty by default: older customers are on their
# own ``{tenant}.dayforcehcm.com`` subdomain (guessable from employer brand),
# but newer ones land on shared shards (``us58``, ``us61``, …) that can only
# be resolved by crawling the actual careers page. The discovery pipeline
# auto-fills ``data/companies/dayforce.txt`` from URL hits.
DAYFORCE_SEED: tuple[str, ...] = ()


SEEDS: dict[str, tuple[str, ...]] = {
    "greenhouse": GREENHOUSE_SEED,
    "lever": LEVER_SEED,
    "ashby": ASHBY_SEED,
    "smartrecruiters": SMARTRECRUITERS_SEED,
    "workable": WORKABLE_SEED,
    "workday": WORKDAY_SEED,
    "icims": ICIMS_SEED,
    "recruitee": RECRUITEE_SEED,
    "personio": PERSONIO_SEED,
    "jobvite": JOBVITE_SEED,
    "jazzhr": JAZZHR_SEED,
    "eightfold": EIGHTFOLD_SEED,
    "rippling": RIPPLING_SEED,
    "teamtailor": TEAMTAILOR_SEED,
    "successfactors": SUCCESSFACTORS_SEED,
    "bamboohr": BAMBOOHR_SEED,
    "paylocity": PAYLOCITY_SEED,
    "ukg": UKG_SEED,
    "oracle_rc": ORACLE_RC_SEED,
    "dayforce": DAYFORCE_SEED,
}


def seed(source_name: str) -> list[str]:
    return list(SEEDS.get(source_name, ()))
