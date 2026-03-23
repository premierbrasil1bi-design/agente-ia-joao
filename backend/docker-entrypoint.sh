#!/bin/sh
set -e
cd /app
node scripts/ensure-db-schema.js
exec node server.js
