"""Create the database schema. Idempotent — safe to re-run."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.storage import Storage  # noqa: E402

if __name__ == "__main__":
    s = Storage()
    print(f"Database ready at: {s.engine.url}")
