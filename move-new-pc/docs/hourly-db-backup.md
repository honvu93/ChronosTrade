---
title: Local Database Backup Guide
description: Current backup guidance for the local-first TV-GIT development environment.
author: Codex
date: 2026-03-12
---

# Local Database Backup Guide

## Current Reality

This repository is currently operated as a local-first project.

- The active day-to-day environment is local development.
- The local PostgreSQL/TimescaleDB container is `binance-timescaledb`.
- The local database is exposed on `127.0.0.1:5433`.
- There is no active VPS-based backup workflow documented as part of the current operating model.

The repository still contains legacy infrastructure files for a VPS-oriented backup flow:

- `infrastructure/scripts/backup_db.sh`
- `infrastructure/backup.env.example`
- `infrastructure/systemd/lib-trade-db-backup.service`
- `infrastructure/systemd/lib-trade-db-backup.timer`
- `deploy.sh`

Those files should be treated as historical infrastructure artifacts unless the team explicitly resumes VPS deployment work.

## Purpose

This guide documents the safe way to create and restore local database backups for the current project setup.

Use it when you need to:

- take a manual backup before risky local changes
- move the project to another machine
- preserve a local database snapshot before schema work
- restore a known-good dump into the local Docker database

## Active Local Stack

The local Docker stack is defined by `docker-compose.yml` and currently uses:

- PostgreSQL/TimescaleDB container: `binance-timescaledb`
- Redis container: `binance-redis`
- Database name: `binance_trade`
- Database user: `postgres`
- Database port on host: `5433`

The backend `.env` in this repo points to:

```env
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5433/binance_trade?schema=public"
```

## Recommended Backup Format

Use PostgreSQL custom-format dumps created with `pg_dump -Fc`.

Why this format is preferred:

- smaller than plain SQL in many cases
- works cleanly with `pg_restore`
- easier to validate than ad hoc SQL output
- already used elsewhere in the repo for transfer and restore guidance

Optionally, create a schema-only SQL file alongside the full dump for quick inspection.

## Manual Local Backup

### 1. Make sure the database container is running

```powershell
docker compose up -d
docker ps --format "table {{.Names}}\t{{.Status}}"
```

Expected database container:

- `binance-timescaledb`

### 2. Create a local backup directory

Example:

```powershell
New-Item -ItemType Directory -Force .\backups\postgres | Out-Null
```

### 3. Create a custom-format dump inside the container

```powershell
docker exec binance-timescaledb sh -c "pg_dump -U postgres -d binance_trade -Fc -f /tmp/binance_trade.dump"
docker cp binance-timescaledb:/tmp/binance_trade.dump .\backups\postgres\binance_trade.dump
```

### 4. Optional: create a schema-only snapshot

```powershell
docker exec binance-timescaledb sh -c "pg_dump -U postgres -d binance_trade --schema-only -f /tmp/binance_trade_schema.sql"
docker cp binance-timescaledb:/tmp/binance_trade_schema.sql .\backups\postgres\binance_trade_schema.sql
```

### 5. Optional: validate the dump

```powershell
docker exec binance-timescaledb sh -c "pg_restore --list /tmp/binance_trade.dump > /dev/null"
```

If you copied the dump out and removed the container-side file, copy it back first or run `pg_restore --list` on another PostgreSQL-capable machine.

## Local Restore Procedure

### Safety note

Restore will overwrite the current local database if you drop and recreate `binance_trade`.

The database in this repository must still be treated as production-like user data. Do not replace it casually.

### Restore a dump into the active local DB

```powershell
docker cp .\backups\postgres\binance_trade.dump binance-timescaledb:/tmp/binance_trade.dump
docker exec binance-timescaledb sh -c "dropdb -U postgres --if-exists binance_trade"
docker exec binance-timescaledb sh -c "createdb -U postgres binance_trade"
docker exec binance-timescaledb sh -c "pg_restore -U postgres -d binance_trade --clean --if-exists /tmp/binance_trade.dump"
```

After restore:

```powershell
npx prisma generate
npx prisma migrate deploy
```

Run migrations only if the dump may be older than the current schema on disk.

### Safer validation restore

If you want to inspect a dump without touching the active DB:

```powershell
docker cp .\backups\postgres\binance_trade.dump binance-timescaledb:/tmp/binance_trade.dump
docker exec binance-timescaledb sh -c "dropdb -U postgres --if-exists binance_trade_restore_check"
docker exec binance-timescaledb sh -c "createdb -U postgres binance_trade_restore_check"
docker exec binance-timescaledb sh -c "pg_restore -U postgres -d binance_trade_restore_check /tmp/binance_trade.dump"
```

## Suggested File Naming

For manual backups, prefer timestamped names:

- `binance_trade_20260312T160000Z.dump`
- `binance_trade_20260312T160000Z_schema.sql`

This makes it easier to keep multiple snapshots while preserving a stable naming convention.

## Relationship To Existing Infrastructure Files

### `infrastructure/scripts/backup_db.sh`

This script still exists, but its default configuration targets the old VPS-oriented naming and paths:

- default container: `lib-trade-db`
- default backup root: `/opt/lib-trade/backups/postgres`

That does **not** match the active local stack.

If you want to reuse the script locally, you must override its environment values first.

Example:

```powershell
$env:BACKUP_ROOT = (Resolve-Path .\backups\postgres).Path
$env:DB_CONTAINER = "binance-timescaledb"
$env:DB_USER = "postgres"
$env:DB_NAME = "binance_trade"
bash infrastructure/scripts/backup_db.sh
```

If Git Bash or another Bash runtime is not available on Windows, prefer the manual Docker commands in this document.

### `deploy.sh` and `infrastructure/systemd/*`

These files describe a previous or planned VPS deployment path.

They are not part of the current local operating workflow and should not be treated as the primary source of truth for current project backup operations.

## Verification Checklist

After taking a local backup, verify:

- `docker ps` shows `binance-timescaledb` running
- the dump file exists under your chosen backup directory
- the dump file size is non-trivial
- `pg_restore --list` can read the dump
- you know whether the dump was taken before or after the latest migrations

## Quick Commands

Create a local dump:

```powershell
docker exec binance-timescaledb sh -c "pg_dump -U postgres -d binance_trade -Fc -f /tmp/binance_trade.dump"
docker cp binance-timescaledb:/tmp/binance_trade.dump .\backups\postgres\binance_trade.dump
```

Restore into local DB:

```powershell
docker cp .\backups\postgres\binance_trade.dump binance-timescaledb:/tmp/binance_trade.dump
docker exec binance-timescaledb sh -c "dropdb -U postgres --if-exists binance_trade"
docker exec binance-timescaledb sh -c "createdb -U postgres binance_trade"
docker exec binance-timescaledb sh -c "pg_restore -U postgres -d binance_trade --clean --if-exists /tmp/binance_trade.dump"
```

## Summary

The current project should be documented as using manual local database backups against `binance-timescaledb`, not an active VPS `systemd` timer flow.

If the team later returns to VPS deployment, this document should be updated again and clearly separated into:

- active local workflow
- optional deployment-specific backup workflow
