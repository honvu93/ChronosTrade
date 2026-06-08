# Frontend Development Guide

## Purpose

This directory contains the Next.js frontend for the local-first TV-GIT project.

The frontend is not deployed from this README. This file documents the active local development workflow.

## Local Runtime

- frontend dev server: `http://localhost:5001`
- backend API: `http://localhost:3001`
- backend Socket.IO endpoint: `http://localhost:3001`

## Install

From the repository root:

```bash
npm --prefix web install
```

Or from inside `web/`:

```bash
npm install
```

## Run The Frontend

```bash
npm --prefix web run dev
```

This uses the script defined in `web/package.json`:

```json
"dev": "next dev -p 5001"
```

## Environment

Recommended `web/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_SOCKET_URL=http://localhost:3001
```

These values must target the backend, not the frontend port.

## Local Rewrites

`web/next.config.ts` currently rewrites:

- `/api/:path*` -> `http://127.0.0.1:3001/api/:path*`
- `/socket.io/:path*` -> `http://127.0.0.1:3001/socket.io/:path*`

That helps local frontend requests reach the backend during development.

## Useful Commands

Start dev server:

```bash
npm --prefix web run dev
```

Build:

```bash
npm --prefix web run build
```

Unit tests:

```bash
npm --prefix web run test:unit
```

E2E tests:

```bash
npm --prefix web run test:e2e
```

## Common Issues

### Frontend loads but API calls fail

Check:

- backend is running on `3001`
- `NEXT_PUBLIC_API_URL` is correct
- local rewrites in `next.config.ts` were not changed accidentally

### Frontend loads but realtime features fail

Check:

- backend is running
- `NEXT_PUBLIC_SOCKET_URL` is `http://localhost:3001`

## Related Docs

- [docs/new-dev-setup.md](../move-new-pc/docs/new-dev-setup.md)
- [run.md](../run.md)
