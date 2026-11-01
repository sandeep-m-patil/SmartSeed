#!/bin/sh
# Creates the RLS-bound application role and the databases. Local/dev/test only;
# staging/production roles are provisioned by infrastructure tooling.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
CREATE ROLE smartseed_app LOGIN PASSWORD '${APP_DB_PASSWORD:-smartseed_app}' NOSUPERUSER NOBYPASSRLS;
CREATE DATABASE smartseed;
CREATE DATABASE smartseed_test;
GRANT CONNECT ON DATABASE smartseed, smartseed_test TO smartseed_app;
SQL
