# 08 - Frontend Dashboard (Disaster Recovery Reference)

This document contains enough architectural detail to rebuild the frontend web dashboard from scratch.

---

## 1. Tech Stack

| Dependency | Version | Purpose |
|---|---|---|
| Next.js | 16.1.6 | App-router framework, dev server on `:5001` |
| React | 19.2.3 | UI library |
| TypeScript | ^5 | Strict mode, target ES2017, module bundler resolution |
| Tailwind CSS | 4 | Utility-first styling via `@tailwindcss/postcss` plugin |
| Zustand | 5.0.11 | Lightweight client state management |
| TanStack React Query | 5.90.21 | Server state, caching, refetch |
| Socket.IO Client | 4.8.3 | Real-time WebSocket connection to backend |
| Lightweight Charts | 5.1.0 | TradingView-style candlestick/indicator charting |
| Recharts | 3.8.0 | General-purpose charts (equity curves, bar charts) |
| Axios | 1.13.6 | Available but primary HTTP is native `fetch` |
| Radix UI | Various | Headless primitives: Dialog, DropdownMenu, Popover, ScrollArea, Select, Tabs, Tooltip |
| Lucide React | 0.575.0 | Icon library |
| Framer Motion | 12.34.3 | Animation |
| Luxon | 3.7.2 | Date/time formatting and relative time |
| Geist | 1.7.0 | Font family (sans + mono) |
| clsx + tailwind-merge | Latest | Conditional class merging |
| Playwright | 1.50.0 | E2E testing (dev dependency) |

## 2. Project Structure

```
web/
  next.config.ts          # Rewrites /api/* and /socket.io/* to backend :3001
  package.json
  tsconfig.json           # Path alias: @/* -> ./src/*
  postcss.config.mjs      # @tailwindcss/postcss plugin
  test/
    run-unit-tests.cjs    # Custom unit test runner (node:test, .test-dist/)
  src/
    app/                  # Next.js App Router pages
      layout.tsx          # Root layout (html, body, Providers, AppChrome)
      page.tsx            # Home page (chart)
      globals.css         # Tailwind theme, design tokens, custom utilities
      login/page.tsx
      signals/
        page.tsx
        composer/page.tsx
        backtests/[runId]/page.tsx
      trading/
        page.tsx
        history/page.tsx
        history/[recordId]/page.tsx
      indicators/
        page.tsx
        [id]/chart/page.tsx
      reports/
        page.tsx
        portfolio/page.tsx
      engine/page.tsx     # Redirects to /reports
      admin/
        users/page.tsx
        monitoring/page.tsx
        indicator-catalog/page.tsx
        backtest-knowledge/page.tsx
      docs/page.tsx
      public/
        history/page.tsx
        reports/page.tsx
    components/
      Providers.tsx       # QueryClient + auth bootstrap + SocketProvider
      SocketProvider.tsx   # Socket.IO context provider
      ErrorBoundary.tsx
      auth/               # AccessGate, LoginWorkspace
      layout/             # AppChrome, TopNav, ModuleRail, MainLayout, WatchlistPanel, etc.
      chart/              # MultiPaneChart, ChartLegend, ChartStatusBar, DataFreshness
      signals/            # SignalsWorkspace, SignalComposerPage, backtests/
      trading/            # TradingWorkspace, TradeHistory, FailureClassification, etc.
      reports/            # ReportsWorkspace, BacktestLeaderboardPanel, PortfolioBacktest
      indicators/         # AlertConfigurationModal, IndicatorLogConsole, TraceDrawer
      admin/              # AdminUsersWorkspace, AdminMonitoringWorkspace, IndicatorCatalog
      ui/                 # FactCard, MetricCard, SectionCard, Sparkline, SyncStatus
      public/             # PublicTradeHistory, PublicReports (unauthenticated)
      docs/               # DocsWorkspace
    store/                # Zustand stores
    hooks/                # Custom React hooks
    lib/                  # API clients, auth, utilities, indicator math, translations
    types/                # TypeScript type definitions
    utils/                # General utility functions
```

## 3. Routing and Pages

### Authentication

| Route | Access | Component | Description |
|---|---|---|---|
| `/login` | Public | `LoginWorkspace` | Username/password form. Redirects to `?next=` path or first allowed module after login. |

### Main Application (requires authentication)

| Route | Required Modules | Component | Description |
|---|---|---|---|
| `/` | `chart` | `MultiPaneChart` + `WatchlistPanel` | Chart workspace. Live candlestick chart with indicator overlays, session shading, symbol search. Default landing page. |
| `/signals` | `signal` | `SignalsWorkspace` | Signal definition management. List signal definitions, run backtests, review results, promote to live indicators. |
| `/signals/composer` | `signal` | `SignalComposerPage` | Visual composer for building composed signals from tech indicator blocks (RSI, EMA, etc.). |
| `/signals/backtests/[runId]` | `signal`, `report` | `BacktestDetailWorkspace` | Detailed backtest run view: equity curve, trade list, event timeline, trade replay chart. |
| `/indicators` | `signal` + `engine` | `IndicatorsPage` | Fleet dashboard for live indicator instances. Shows status (ACTIVE/PAUSED/ARCHIVED), heartbeat staleness, error state. Actions: pause, resume, archive, configure alerts, open analyzer. |
| `/indicators/[id]/chart` | `signal` + `engine` | `IndicatorChartPage` | Single indicator analyzer: live chart with indicator events as markers, real-time event stream via Socket.IO, log console, settings drawer, trace drawer for event inspection. |
| `/reports` | `report` or `engine` | `ReportsWorkspace` | Analytics workspace with backtest leaderboard, performance metrics. |
| `/reports/portfolio` | `report` or `engine` | `PortfolioBacktestWorkspace` | Portfolio-level backtest aggregation across multiple strategies. |
| `/trading` | `trading` | `TradingWorkspace` | Live trading command center: account connection, signal eligibility, execution records, external deployments (Telegram), discrepancy detection, incident investigation. |
| `/trading/history` | `trading` | `TradeHistoryStandalonePage` | Full trade history with audit trail. |
| `/trading/history/[recordId]` | `trading` | `TradeHistoryDetailPage` | Single trade record detail with audit drawer. |
| `/engine` | - | Redirect | Immediately redirects to `/reports`. |
| `/docs` | Any authenticated | `DocsWorkspace` | Platform documentation viewer. |

### Admin (requires `ADMIN` role)

| Route | Component | Description |
|---|---|---|
| `/admin/monitoring` | `AdminMonitoringWorkspace` | System health: API/DB/MT5 status, candle distribution, symbol freshness, error alerts, table row counts. |
| `/admin/users` | `AdminUsersWorkspace` | User management: create/edit users, assign roles (ADMIN/USER), grant module access (chart, signal, report, trading, engine). |
| `/admin/indicator-catalog` | `AdminIndicatorCatalogWorkspace` | Tech indicator catalog lifecycle: DRAFT/PUBLISHED/RETIRED status, runtime binding validation, dependency tracking. |
| `/admin/backtest-knowledge` | `BacktestKnowledgeBase` | Optimization history, configuration rules, and production decisions. |

### Public (no authentication required)

| Route | Component | Description |
|---|---|---|
| `/public/history` | `PublicTradeHistory` | Public-facing trade history and performance metrics. |
| `/public/reports` | `PublicReports` | Public-facing trading performance reports. |

## 4. Layout System

### Root Layout (`app/layout.tsx`)

```
<html lang="en" className="dark">
  <body>
    <script> (locale bootstrap - reads localStorage, sets data-locale) </script>
    <Providers>          <!-- QueryClient, auth bootstrap, SocketProvider -->
      <AppChrome>        <!-- Conditional shell: TopNav + ModuleRail or bare -->
        {children}       <!-- Page content -->
      </AppChrome>
    </Providers>
  </body>
</html>
```

The app always renders in dark mode (`className="dark"` on html).

### AppChrome (`components/layout/AppChrome.tsx`)

Conditionally renders the application shell. Chrome is **hidden** when:
- Current path is `/login`
- Current path starts with `/public`
- User is not authenticated

When chrome is visible, the layout is:
```
+-----------------------------------------------+
| TopNav (full width, sticky top)                |
|   - Workspace context label + title            |
|   - Symbol search (fetches /api/symbols)       |
|   - Language switch (en/vi)                     |
|   - User info + sign-out button                |
|   - Mobile: horizontal nav pills               |
+-----------------------------------------------+
| ModuleRail |  Page Content                     |
| (left,     |  (flex-1, overflow-hidden)        |
|  104px,    |                                   |
|  vertical  |                                   |
|  icon nav) |                                   |
|            |                                   |
+-----------------------------------------------+
```

### ModuleRail (`components/layout/ModuleRail.tsx`)

Vertical sidebar (hidden on mobile, 104px wide on `lg+`). Renders navigation items based on user's module grants. Icons from Lucide. Active state highlighted with accent color glow.

Navigation items are built by `navigationModel.ts`:
- **Chart** (`/`) -- requires `chart` module
- **Signals** (`/signals`) -- requires `signal` module
- **Analytics** (`/reports`) -- requires `report` or `engine` module
- **Indicators** (`/indicators`) -- requires `signal` + `engine` modules
- **Trading** (`/trading`) -- requires `trading` module
- **Admin** (`/admin/monitoring`) -- requires `ADMIN` role
- **Docs** (`/docs`) -- visible to all authenticated users

### MainLayout (`components/layout/MainLayout.tsx`)

Inner page layout with optional left and right sidebars. Uses rounded `command-deck-surface` styling. Responsive: sidebars stack vertically on small screens, side-by-side on `xl+`.

Props: `children`, `leftSidebar?`, `rightSidebar?`

### TopNav (`components/layout/TopNav.tsx`)

- Displays workspace context (module label, title, description) based on current pathname via `resolveWorkspaceContextForLocale()`
- Symbol search dropdown: fetches available symbols from `/api/symbols`, filters as user types, updates `useMarketStore` on selection
- Language switch: English/Vietnamese toggle
- User display name + role badge
- Sign-out button: calls `/api/auth/logout`, clears session storage, redirects to `/login`
- Mobile: horizontal scrollable nav pills

## 5. State Management

### `useAuthStore` (Zustand)

Manages authentication lifecycle.

```typescript
interface AuthStoreState {
    status: "loading" | "authenticated" | "anonymous";
    accessToken: string | null;
    session: AuthSessionSnapshot | null;  // { user, firstAllowedPath, accessTokenExpiresAt }
    error: string | null;
    setLoading(): void;
    setAuthenticated(session, accessToken?): void;
    setAnonymous(error?): void;
}
```

### `useMarketStore` (Zustand)

Tracks the globally selected symbol and timeframe for the chart workspace.

```typescript
interface MarketState {
    symbol: string;       // default: "BTCUSD"
    timeframe: string;    // default: "1m"
    setSymbol(symbol): void;
    setTimeframe(timeframe): void;
}
```

### `useFeatureStore` (Zustand)

Holds trading feature flags snapshot (read/write/automation tiers).

```typescript
interface FeatureStoreState {
    status: "idle" | "loading" | "ready" | "error";
    snapshot: TradingFeatureFlagSnapshot | null;
    error: string | null;
    setLoading(): void;
    setSnapshot(snapshot): void;
    setError(message): void;
}
```

### `useConnectionStatus` (Zustand)

Tracks Socket.IO connection state.

```typescript
interface ConnectionStatusStore {
    status: "connected" | "disconnected" | "reconnecting" | "failed";
    setStatus(status): void;
}
```

### `useDataFreshness` (Zustand)

Tracks candle data freshness for the current symbol/timeframe.

```typescript
interface DataFreshnessStoreState {
    freshnessState: DataFreshnessState;  // "loading" | "fresh" | "stale" | "error"
    latestTimestamp: string | null;
    candleCount: number;
    setFreshness(update): void;
    setError(): void;
}
```

### `useLocaleStore` (Zustand + persist)

Persists locale preference to `localStorage`.

```typescript
interface LocaleStoreState {
    locale: "en" | "vi";   // default: "en"
    setLocale(locale): void;
}
```

Persistence key: read from `APP_LOCALE_STORAGE_KEY` in `lib/localeStorage.ts`.

## 6. Server Communication

### API Proxy

Next.js rewrites in `next.config.ts` proxy all API calls through the frontend dev server:

```
/api/*        -> http://127.0.0.1:3001/api/*
/socket.io/*  -> http://127.0.0.1:3001/socket.io/*
```

In production, the frontend and backend may share the same origin, or `NEXT_PUBLIC_API_URL` can be set.

### Auth Fetch Interceptor

`Providers.tsx` replaces `window.fetch` with `createAuthFetch()` on mount. This wrapper:

1. Passes non-API requests through unmodified
2. For `/api/*` requests, always sets `credentials: "include"` (cookie-based auth)
3. On 401 response, automatically attempts a single refresh via `POST /api/auth/refresh`
4. On successful refresh, updates the auth store and retries the original request
5. On failed refresh, sets auth status to anonymous and returns a synthetic 401 response
6. Excludes `/api/auth/login`, `/api/auth/logout`, and `/api/auth/refresh` from retry logic
7. Serializes concurrent refresh attempts (single `refreshPromise`)

### Auth API (`lib/authApi.ts`)

All auth calls use native `fetch` with `credentials: "include"`:

| Function | Method | Endpoint | Returns |
|---|---|---|---|
| `loginWithPassword(identifier, password)` | POST | `/api/auth/login` | `{ session }` |
| `loadCurrentSession()` | GET | `/api/auth/session` | `{ session }` |
| `refreshCurrentSession()` | POST | `/api/auth/refresh` | `{ session }` |
| `logoutCurrentSession()` | POST | `/api/auth/logout` | `{ success }` |
| `listManagedUsers()` | GET | `/api/auth/users` | `User[]` |
| `createManagedUser(input)` | POST | `/api/auth/users` | `User` |
| `updateManagedUser(userId, input)` | PATCH | `/api/auth/users/:userId` | `User` |

### React Query Setup

`QueryClient` created in `Providers.tsx` with:
- `refetchOnWindowFocus: false`

Individual queries and mutations are defined inline in workspace components and custom hooks. The pattern is standard TanStack React Query v5.

### Token Storage

Auth tokens stored in `localStorage` under keys: `tvgit.accessToken`, `accessToken`, `authToken`. These are cleared on login/logout/refresh. The primary auth mechanism is HTTP-only cookies set by the backend; localStorage tokens serve as a fallback lookup.

## 7. Real-time Data (Socket.IO)

### Connection Setup

`SocketProvider` (wraps entire app inside `Providers`):

1. Creates a single `socket.io-client` connection when `enabled` is true
2. Enabled when: user is authenticated AND not on `/login` page
3. Connection URL resolved by `resolveSocketUrl()`:
   - Uses `NEXT_PUBLIC_SOCKET_URL` if set
   - In local dev (port 5001), redirects to port 3001 directly (bypasses Next.js proxy for WebSocket reliability)
   - In production, uses same origin
4. Config: `reconnection: true`, `reconnectionAttempts: 5`, `reconnectionDelay: 1000`, `withCredentials: true`

### Connection State

Socket events update `useConnectionStatus` store:
- `connect` -> `"connected"`
- `disconnect` -> `"disconnected"`
- `reconnect_attempt` -> `"reconnecting"`
- `reconnect_failed` -> `"failed"`
- `reconnect` -> `"connected"`

### Consumer Pattern

Components access the socket via `useSocketContext()` hook (from `SocketProvider`):

```typescript
const { socket, connected } = useSocketContext();
```

There is also a standalone `useSocket()` hook in `hooks/useSocket.ts` that creates its own connection (used by components that need independent socket lifecycle).

### Key Real-time Events

- **`indicator:events`** -- New indicator events from the live runner. Used on the indicator chart page to append events in real-time.
- Room-based subscriptions for `workspace:indicators`, `SYMBOL:TIMEFRAME`, `indicator:logs:INSTANCE_ID` (joined by backend, client listens).

## 8. Charting

### Lightweight Charts Integration

The `useChartEngine` hook (`hooks/useChartEngine.ts`) wraps the Lightweight Charts v5 API:

**Initialization:**
- Dark theme: background `#0D1117`, text `#8B949E`, grid lines nearly invisible
- Crosshair mode: Normal, with styled labels
- Pane layout: 80% price pane, 20% indicator pane (RSI/volume)

**Series Management:**
- `addCandlestickSeries(id, options)` -- Green up (`#26C870`), red down (`#F6465D`)
- `addHistogramSeries(id, options)` -- Volume bars
- `addLineSeries(id, options)` -- Indicator overlays (EMA, SMA, WMA)
- `setSeriesData(id, data)`, `updateSeriesData(id, point)` -- Bulk load and live tick update
- `setSeriesVisibility(id, visible)` -- Toggle indicator overlays

**Interaction:**
- `subscribeCrosshairMove(callback)` -- Legend data updates on hover
- `subscribeClick(callback)` -- Marker click handling (trade replay, event inspection)
- `subscribeVisibleLogicalRangeChange(callback)` -- Infinite scroll / data loading
- `resize(width, height)` -- Responsive resize

### MultiPaneChart Component

The main chart component (`components/chart/MultiPaneChart.tsx`):

**Props:**
- `annotations?: EngineAnnotation[]` -- Backtest/engine trade markers
- `rangeStart/rangeEnd?: string` -- Constrain visible time range
- `showSessionShading?: boolean` -- ASIAN/LONDON/NY session background bands
- `indicatorEvents?: IndicatorEvent[]` -- Live indicator event markers
- `onMarkerClick?: (eventId) => void` -- Marker click handler
- `focusedSignalId?: string` -- Highlight a specific signal

**Data flow:**
1. Reads `symbol` and `timeframe` from `useMarketStore`
2. Fetches candle data from `/api/candles?symbol=X&timeframe=Y`
3. Calculates technical indicators client-side: SMA, RSI, EMA, WMA (via `lib/indicators.ts`)
4. Renders candlestick series + volume histogram + indicator line overlays
5. Supports session shading (ASIAN 00-08, LONDON 08-13, NY 13-22 UTC)

**Indicator math** (`lib/indicators.ts`):
- `calculateSMA(data, period)` -- Simple Moving Average
- `calculateRSI(data, period)` -- Relative Strength Index
- `calculateEMA(data, period)` -- Exponential Moving Average
- `calculateWMA(data, period)` -- Weighted Moving Average

### Supporting Chart Components

| Component | Purpose |
|---|---|
| `ChartLegend` | OHLC legend overlay with change percentage |
| `ChartStatusBar` | Symbol/timeframe context bar |
| `ConnectionStatusBar` | Socket.IO connection status indicator |
| `DataFreshnessBar` | Candle data staleness warning |
| `DataFreshnessPoller` | Periodically checks data freshness |
| `IndicatorOverlayPanel` | Toggle visibility of indicator overlays (EMA, SMA, etc.) |
| `RsiSettingsDialog` | Configure RSI period/overbought/oversold levels |

## 9. Key Components

### Auth Components

| Component | Purpose |
|---|---|
| `AccessGate` | Route guard. Props: `requiredModules?: AuthModuleKey[]`, `requireAdmin?: boolean`. Shows loading spinner during auth check, redirects to `/login` if anonymous, shows "access denied" with redirect link if module access missing. |
| `LoginWorkspace` | Full login page. Two-column layout: left panel describes admin/user lanes, right panel has username/password form. Supports `?next=` redirect parameter. Bilingual (en/vi). |

### Layout Components

| Component | Purpose |
|---|---|
| `AppChrome` | Outer shell: TopNav + ModuleRail + content area. Hidden on login/public pages. |
| `TopNav` | Header bar with workspace context, symbol search, language switch, user info, sign-out. |
| `ModuleRail` | Left sidebar with icon-based module navigation. Hidden on mobile. |
| `MainLayout` | Inner content wrapper with optional left/right sidebars. Rounded card style. |
| `WatchlistPanel` | Right sidebar on home page. Symbol watchlist. |
| `NotificationToaster` | Toast notification display. |
| `UrlSync` | Syncs URL query params with market store (symbol/timeframe). |
| `LanguageSwitch` | en/vi locale toggle button. |
| `TimeframeSwitcher` | Timeframe selection pills (1m, 5m, 15m, 1h, 4h, 1d, etc.). |

### Signal/Backtest Components

| Component | Purpose |
|---|---|
| `SignalsWorkspace` | Main signals page: list definitions, generate backtests, view results. |
| `SignalComposerPage` | Visual signal builder using composed blocks (indicator + condition pairs). |
| `CompositionCanvas` | Drag-drop canvas for composing signal blocks. |
| `IndicatorBlockCatalog` | Browse available tech indicators and their conditions. |
| `BacktestDetailWorkspace` | Single backtest run: metrics, equity curve, trade list, trade replay. |
| `BatchBacktestComparison` | Compare multiple backtest runs side by side. |

### Trading Components

| Component | Purpose |
|---|---|
| `TradingWorkspace` | Main trading page: accounts, execution records, automation status. |
| `TradingAccountConnectionPanel` | MT5 account connection management. |
| `TradingAccountReadinessPanel` | Pre-trade readiness checks. |
| `TradingExecutionRecordRail` | Live execution command history. |
| `TradingExternalDeploymentPanel` | Telegram/webhook signal deployment config. |
| `TradingExternalActionAuditPanel` | External action delivery audit trail. |
| `TradingDiscrepancyDrawer` | Position discrepancy detection between system and broker. |
| `TradingIncidentInvestigationRail` | Trading incident investigation tools. |
| `SignalLiveEligibilityPanel` | Check if a signal meets live deployment criteria. |
| `FailureClassificationPanel` | Classify and analyze trade failures. |
| `TradeHistoryStandalonePage` | Full trade history with filters and metrics. |
| `TradeHistoryDetailPage` | Single trade detail with chart replay. |
| `TradeHistoryAuditDrawer/Panel` | Trade audit trail viewer. |

### Admin Components

| Component | Purpose |
|---|---|
| `AdminSectionTabs` | Tab navigation between admin sub-pages (Users, Monitoring, Indicator Catalog). |
| `AdminUsersWorkspace` | CRUD for users: create/edit users, assign roles and module grants. |
| `AdminMonitoringWorkspace` | System health dashboard: API/DB/MT5 health checks, candle freshness, error alerts, table counts. |
| `AdminIndicatorCatalogWorkspace` | Indicator catalog management: create/publish/retire indicators, validate runtime bindings. |
| `BacktestKnowledgeBase` | Browse optimization history and production decisions. |

### Report Components

| Component | Purpose |
|---|---|
| `ReportsWorkspace` | Analytics dashboard. |
| `BacktestLeaderboardPanel` | Ranked table of backtest runs with sorting, filtering, caution flags. |
| `PortfolioBacktestWorkspace` | Multi-strategy portfolio aggregation view. |

### Indicator Components

| Component | Purpose |
|---|---|
| `AlertConfigurationModal` | Configure price/indicator/volatility alerts for an indicator instance. |
| `IndicatorLogConsole` | Real-time log stream for a running indicator (via Socket.IO room). |
| `IndicatorTraceDrawer` | Inspect indicator logic trace for a specific event (state transitions, indicator values, thresholds). |
| `IndicatorSettingsDrawer` | Edit indicator instance parameters and execution config. |

### UI Primitives

| Component | Purpose |
|---|---|
| `FactCard` | Key-value fact display card. |
| `MetricCard` | Numeric metric with label, optional sparkline. |
| `SectionCard` | Titled content section with border and padding. |
| `Sparkline` | Inline mini chart. |
| `StateBanner` | Status banner (success/warning/error). |
| `SyncStatus` | Data sync status indicator (positioned absolute bottom-right on chart page). |

## 10. Authentication Flow

### Login Flow

1. User navigates to any protected page
2. `AccessGate` detects `status === "anonymous"`, redirects to `/login?next=/original-path`
3. `LoginWorkspace` renders username/password form
4. On submit: `loginWithPassword()` -> `POST /api/auth/login` with `credentials: "include"`
5. Backend sets HTTP-only cookies (access token + refresh token)
6. Response contains `AuthSessionSnapshot` (user info, modules, token expiry)
7. `setAuthenticated(session)` updates auth store
8. Router navigates to `resolvePostLoginPath(session, nextPath)`:
   - If `?next=` is a valid, accessible path, goes there
   - Otherwise, goes to user's `firstAllowedPath` (computed from modules: chart -> signals -> reports -> trading)

### Session Bootstrap (on page load)

`Providers.tsx` runs once on mount:

1. Calls `loadCurrentSession()` -> `GET /api/auth/session` (uses existing cookies)
2. If 200: `setAuthenticated(session)` -- user is restored
3. If fails: calls `refreshCurrentSession()` -> `POST /api/auth/refresh`
4. If refresh 200: `setAuthenticated(session)` -- token was refreshed
5. If both fail: `setAnonymous()` -- user must log in

### Token Refresh

A timer is set when authenticated:
- `refreshInMs = max(5000, tokenExpiryMs - now - 60000)` -- refresh 60s before expiry
- On timer fire: calls `refreshCurrentSession()`
- On failure: sets anonymous, user sees "Session expired" message

### Fetch Interceptor (automatic refresh)

The `createAuthFetch` wrapper intercepts 401 responses on API calls:
1. Gets 401 on any `/api/*` call (except auth endpoints)
2. Attempts `POST /api/auth/refresh` (serialized -- one at a time)
3. On success: retries the original request
4. On failure: marks user as anonymous

### Module-based Access Control

Auth modules: `chart`, `signal`, `report`, `trading`, `engine`

Each page route is wrapped in `<AccessGate requiredModules={[...]} requireAdmin={bool}>`. The gate checks:
- `isAdmin` bypasses all module checks
- `hasAnyModule(requiredModules)` checks if user has at least one required module
- On failure: shows full-screen "access not enabled" message with link to allowed workspace

## 11. Styling

### Tailwind CSS 4

Config via `postcss.config.mjs` using `@tailwindcss/postcss` plugin. No separate `tailwind.config.ts` file -- all theme tokens defined in `globals.css` using the `@theme` directive.

### Design Tokens (`globals.css`)

```css
@theme {
  /* Backgrounds */
  --color-bg-primary: #111a2b;
  --color-bg-secondary: #0b1220;
  --color-bg-tertiary: #162237;
  --color-bg-card: #0d1625;

  /* Borders */
  --color-border-base: #31445f;
  --color-border-muted: #26364f;

  /* Accent */
  --color-accent: #4d8cff;
  --color-accent-glow: rgba(77, 140, 255, 0.32);

  /* Text */
  --color-text-primary: #e7edf7;
  --color-text-secondary: #c7d3e6;
  --color-text-muted: #9eb0c9;

  /* Price */
  --color-price-up: #2ca6a4;
  --color-price-down: #d86060;
  --color-price-neutral: #7f93b1;

  /* Semantic */
  --color-semantic-success: #2ca6a4;
  --color-semantic-warning: #d3a44b;
  --color-semantic-error: #d86060;

  /* Fonts */
  --font-sans: var(--font-geist-sans), ui-sans-serif, system-ui;
  --font-mono: var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, ...;

  /* Shadows */
  --shadow-premium: 0 24px 64px rgba(4, 10, 22, 0.32);
  --shadow-glass: 0 20px 60px rgba(4, 10, 22, 0.36);
}
```

### Custom Utilities

- `.glass` -- Frosted glass effect: `bg-bg-primary/78 backdrop-blur-xl` with shadow
- `.text-gradient` -- Gradient text from white to accent blue
- `.command-deck-canvas` -- Radial gradient background (used on page canvases)
- `.command-deck-surface` -- Linear gradient card background with deep shadow

### Visual Design Language

- Dark-only theme (no light mode)
- Rounded corners: `rounded-[28px]` for surfaces, `rounded-2xl` for cards, `rounded-full` for pills/buttons
- Heavy use of `backdrop-blur-xl` for glass effects
- Font weight: heavy use of `font-black` and `font-bold`
- Uppercase tracking: labels use `text-[10px] font-black uppercase tracking-[0.2em]`
- Color accents: blue (`#4d8cff`) for primary actions, teal (`#2ca6a4`) for positive/up, red (`#d86060`) for negative/down
- Custom scrollbar styling (dark themed)

### Radix UI Usage

Radix primitives provide accessible, unstyled building blocks:
- `@radix-ui/react-dialog` -- Modals (alert config, settings drawers)
- `@radix-ui/react-dropdown-menu` -- Context menus
- `@radix-ui/react-popover` -- Floating panels
- `@radix-ui/react-scroll-area` -- Custom scrollable regions
- `@radix-ui/react-select` -- Styled select dropdowns
- `@radix-ui/react-tabs` -- Tab navigation (admin sections, workspace tabs)
- `@radix-ui/react-tooltip` -- Hover tooltips

## 12. Testing

### Unit Tests

- Runner: Custom script `test/run-unit-tests.cjs` using Node's built-in `node:test` module
- Build step: TypeScript compiled to `.test-dist/` directory using `tsconfig.unit-tests.json`
- Path alias resolution: Custom `Module._resolveFilename` hook maps `@/` to `.test-dist/`
- Test files: `*.test.ts` / `*.test.tsx` co-located with source files
- Run command: `npm --prefix web run test:unit`

Existing test files include:
- `lib/authAccess.test.ts`, `lib/authFetch.test.ts`
- `lib/backtestLeaderboardQuery.test.ts`, `lib/backtestLeaderboardView.test.ts`
- `lib/chartSeriesSanitizer.test.ts`, `lib/freshnessUtils.test.ts`
- `lib/tradingWorkspaceView.test.ts`, `lib/tradingHistoryMetrics.test.ts`
- `components/layout/navigationModel.test.ts`, `components/layout/workspaceContext.test.ts`
- `components/layout/LanguageSwitch.test.tsx`
- `components/reports/BacktestLeaderboardPanel.test.tsx`

### E2E Tests

- Framework: Playwright (`@playwright/test` ^1.50.0)
- Run command: `npm --prefix web run test:e2e`
- No `playwright.config.ts` found in the web directory (may be in root or generated at runtime)

## 13. Internationalization

The dashboard supports two locales: English (`en`) and Vietnamese (`vi`).

- `useLocaleStore` persists preference to localStorage
- `lib/translations.ts` contains the full translation catalog
- `lib/appLocale.ts` defines `AppLocale` type and default
- `LocaleEffects` component syncs locale to `document.documentElement.lang` and `data-locale`/`data-intlLocale` attributes
- Locale bootstrap script in root layout reads localStorage before React hydration to prevent flash
- `useAppLocale()` hook provides current locale and copy catalog to components
- `LanguageSwitch` component toggles between en/vi

## 14. Type System

### Core Type Files (`types/`)

| File | Key Types |
|---|---|
| `auth.ts` | `AuthModuleKey` (`chart\|signal\|report\|trading\|engine`), `AuthRoleKey` (`ADMIN\|USER`), `AuthSessionUser`, `AuthSessionSnapshot`, request/response envelopes |
| `signals.ts` | `SignalDefinition`, `IndicatorInstance`, `IndicatorEvent`, `IndicatorLogicTrace`, `ComposedSignalBlocks`, `ComposedBlockConfig`, `TechIndicatorDefinition`, `IndicatorCatalogRecord`, `GeneratedBacktestRun`, `ExecutionConfigView`, `TradeGuardConfig` |
| `engine.ts` | `EngineRun`, `EngineOverview`, `EquityCurveData`, `BacktestLeaderboardRow`, `EngineAnnotation`, `SignalReviewRow`, `StrategyBreakdownRow`, `SessionBreakdownRow`, `ExitComparisonRow` |
| `backtests.ts` | `BacktestTradeRow`, `BacktestTradeReplayResponse` (full trade replay with candles, levels, markers, trail lines, session ranges, timeline, stage analysis, indicator pane), `BacktestTradeStageAnalysis` |
| `trading.ts` | `TradingFeatureFlagSnapshot`, `TradingCapabilityTier` (`read\|write\|automation`), `TradingAccountMode` (`LIVE\|PAPER`), signal eligibility types |
| `adminMonitoring.ts` | `MonitoringSnapshot`, `MonitoringHealthCheck`, `MonitoringSymbolFreshnessItem`, `MonitoringAlertItem` |

### API Response Pattern

All API responses follow a typed envelope pattern:

```typescript
// Success
{ success: true, data: { ... } }

// Error
{ success: false, error: { code: string, message: string, domain: string, meta?: {} } }
```

## 15. Environment Variables

| Variable | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `web/.env.local` | Backend API base URL (default: same origin via Next.js rewrites) |
| `NEXT_PUBLIC_SOCKET_URL` | `web/.env.local` | Socket.IO server URL (default: auto-detected from origin) |

The Next.js dev server runs on port `5001` and proxies `/api/*` and `/socket.io/*` to the backend on port `3001`. The `allowedDevOrigins` in `next.config.ts` includes `trade.your-domain.com` for tunneled development.
