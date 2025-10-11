#!/usr/bin/env bash

set -euo pipefail

COMPOSE_FILE="docker-compose.yml"
SCHEMA_FILE="./schema.sql"
SERVICE_NAME="postgres"
DB_USER="postgres"
DB_NAME="postgres"

docker compose -f "$COMPOSE_FILE" up -d

echo "Waiting..."
until docker compose exec -T "$SERVICE_NAME" pg_isready -U $DB_USER > /dev/null 2>&1; do
  sleep 0.5
done


echo "Running schema.sql..."
docker compose exec -T "$SERVICE_NAME" psql -U $DB_USER -d $DB_NAME < "$SCHEMA_FILE"

echo "Schema applied"
