"use client";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);
const NEXT_DEV_PROXY_PORT = "5001";
const BACKEND_SOCKET_PORT = "3001";

function isNextDevProxyOrigin(url: URL) {
  return LOCAL_HOSTS.has(url.hostname) && url.port === NEXT_DEV_PROXY_PORT;
}

/**
 * Local Next rewrites proxy REST calls well enough, but Socket.IO reconnects are
 * more reliable when the client talks directly to the backend server.
 */
export function resolveSocketUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SOCKET_URL?.trim();

  if (typeof window === "undefined") {
    return configured || `http://localhost:${BACKEND_SOCKET_PORT}`;
  }

  const fallbackBase = window.location.origin;
  const resolved = new URL(configured || fallbackBase, fallbackBase);

  if (isNextDevProxyOrigin(resolved)) {
    return `${resolved.protocol}//${resolved.hostname}:${BACKEND_SOCKET_PORT}`;
  }

  return resolved.origin;
}
