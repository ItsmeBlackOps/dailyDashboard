-- Reference schema (SQLite / Postgres-compatible).
-- The application auto-creates these on startup via SQLAlchemy; this file
-- is provided for DBAs who want to bootstrap the database by hand.

CREATE TABLE IF NOT EXISTS jobs_raw (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    source_platform       VARCHAR(64)  NOT NULL,
    payload               TEXT         NOT NULL,
    scrape_timestamp_utc  TIMESTAMP    NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_jobs_raw_source ON jobs_raw(source_platform);
CREATE INDEX IF NOT EXISTS ix_jobs_raw_ts     ON jobs_raw(scrape_timestamp_utc);

CREATE TABLE IF NOT EXISTS jobs_clean (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    canonical_key           VARCHAR(64)  NOT NULL,
    job_title               VARCHAR(512) NOT NULL,
    company_name            VARCHAR(256) NOT NULL,
    location                VARCHAR(256),
    country                 VARCHAR(8),
    remote_type             VARCHAR(16),
    employment_type         VARCHAR(64),
    seniority               VARCHAR(32),
    salary                  VARCHAR(128),
    date_posted_raw         VARCHAR(128),
    date_posted_normalized  TIMESTAMP,
    source_platform         VARCHAR(64)  NOT NULL,
    source_url              TEXT         NOT NULL,
    company_careers_url     TEXT,
    source_job_id           VARCHAR(256),
    job_description_snippet TEXT,
    full_job_description    TEXT,
    scrape_timestamp_utc    TIMESTAMP    NOT NULL,
    CONSTRAINT uq_jobs_clean_canonical UNIQUE (canonical_key)
);
CREATE INDEX IF NOT EXISTS ix_jobs_clean_key      ON jobs_clean(canonical_key);
CREATE INDEX IF NOT EXISTS ix_jobs_clean_company  ON jobs_clean(company_name);
CREATE INDEX IF NOT EXISTS ix_jobs_clean_posted   ON jobs_clean(date_posted_normalized);
CREATE INDEX IF NOT EXISTS ix_jobs_clean_src      ON jobs_clean(source_platform);

CREATE TABLE IF NOT EXISTS scrape_runs (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at_utc      TIMESTAMP NOT NULL,
    finished_at_utc     TIMESTAMP,
    total_fetched       INTEGER   DEFAULT 0,
    total_unique        INTEGER   DEFAULT 0,
    total_exported      INTEGER   DEFAULT 0,
    per_source          TEXT,
    failed_sources      TEXT,
    duplicates_removed  INTEGER   DEFAULT 0,
    discarded_stale     INTEGER   DEFAULT 0,
    notes               TEXT
);
