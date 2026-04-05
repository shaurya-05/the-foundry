#!/bin/bash
# Run all database migrations against a target PostgreSQL instance.
# Usage:
#   ./scripts/migrate.sh                        # uses DATABASE_URL from env
#   DATABASE_URL=postgresql://... ./scripts/migrate.sh

set -e

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL is not set."
  echo "Export it before running: export DATABASE_URL=postgresql://user:pass@host:5432/dbname"
  exit 1
fi

MIGRATIONS_DIR="$(dirname "$0")/../backend/migrations"

echo "Running migrations from $MIGRATIONS_DIR against: $DATABASE_URL"
echo ""

for file in "$MIGRATIONS_DIR"/*.sql; do
  echo "  → $(basename "$file")"
  psql "$DATABASE_URL" -f "$file" --quiet
done

echo ""
echo "All migrations applied successfully."
