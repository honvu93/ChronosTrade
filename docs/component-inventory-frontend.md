# Component Inventory — Frontend

_Generated: 2026-04-16 | Deep Scan_

---

## Overview

78 React components organized by feature domain. Uses Radix UI primitives + Tailwind CSS 4. Dark mode default, i18n (English/Vietnamese).

## Pages (21 routes)

| Route | Page | Auth | Module |
|---|---|---|---|
| `/` | Home (Charts) | JWT | CHART |
| `/login` | Authentication | None | — |
| `/trading` | Trading workspace | JWT | TRADING |
| `/trading/history` | Trade history | JWT | TRADING |
| `/trading/history/[recordId]` | Trade detail | JWT | TRADING |
| `/trading/paper-dashboard` | Paper trading | JWT | TRADING |
| `/signals` | Signal management | JWT | SIGNAL |
| `/signals/composer` | Signal composer | JWT | SIGNAL |
| `/signals/backtests/[runId]` | Backtest detail | JWT | SIGNAL |
| `/indicators` | Indicator catalog | JWT | SIGNAL |
| `/indicators/[id]/chart` | Indicator chart | JWT | SIGNAL |
| `/reports` | Reports dashboard | JWT | REPORT |
| `/reports/portfolio` | Portfolio analysis | JWT | REPORT |
| `/admin/monitoring` | System monitoring | Admin | — |
| `/admin/users` | User management | Admin | — |
| `/admin/indicator-catalog` | Indicator admin | Admin | — |
| `/admin/backtest-knowledge` | Knowledge base | Admin | — |
| `/docs` | Documentation | JWT | — |
| `/engine` | Engine workspace | JWT | ENGINE |
| `/public/reports` | Public reports | None | — |
| `/public/history` | Public trade history | None | — |

## Components by Category

### Auth (2)
| Component | Purpose |
|---|---|
| `AccessGate` | Module & admin access control wrapper |
| `LoginWorkspace` | Login form UI |

### Chart (8)
| Component | Purpose |
|---|---|
| `MultiPaneChart` | Main candlestick chart visualization |
| `ChartLegend` | Series legend overlay |
| `ChartStatusBar` | Chart status indicators |
| `ConnectionStatusBar` | WebSocket connection state |
| `DataFreshnessBar` | Data freshness indicator |
| `DataFreshnessPoller` | Polling logic for freshness checks |
| `IndicatorOverlayPanel` | Indicator overlay controls |
| `RsiSettingsDialog` | RSI indicator settings |

### Layout (17)
| Component | Purpose |
|---|---|
| `AppChrome` | Main app shell/chrome with sidebar |
| `MainLayout` | Page layout wrapper |
| `TopNav` | Top navigation bar |
| `ModuleRail` | Module/workspace selector rail |
| `WorkspaceContextBar` | Context bar for current workspace |
| `TimeframeSwitcher` | Timeframe selector dropdown |
| `LanguageSwitch` | Language toggle (en/vi) |
| `LanguageSwitchView` | Language switch UI component |
| `LocaleEffects` | Locale initialization effects |
| `WatchlistPanel` | Right sidebar watchlist container |
| `Watchlist` | Watchlist data display |
| `TickerTape` | Scrolling ticker tape |
| `ChartLandingSurface` | Chart landing state |
| `NotificationToaster` | Toast notifications |
| `ModulePlaceholder` | Placeholder for disabled modules |
| `GettingStartedChecklist` | Onboarding checklist |
| `UrlSync` | URL state synchronization |

### Signals (9)
| Component | Purpose |
|---|---|
| `SignalsWorkspace` | Main signals workspace |
| `SignalComposerPage` | Signal composer builder |
| `SignalDefinitionReviewPanel` | Review composed signals |
| `CompositionCanvas` | Visual composition canvas |
| `ComposedSignalConfig` | Composed signal configuration |
| `IndicatorBlockCatalog` | Block catalog browser |
| `SignalsGenerateWorkspace` | Signal generation workspace |
| `SignalsReviewWorkspace` | Signal review workspace |
| `BatchBacktestComparison` | Batch backtest comparison view |

### Signals — Backtests (7)
| Component | Purpose |
|---|---|
| `BacktestDetailWorkspace` | Backtest run detail view |
| `BacktestRunComparisonPanel` | Compare multiple runs |
| `BacktestConfidenceChangeCard` | Confidence metrics card |
| `BacktestEquityCurve` | Equity curve chart |
| `BacktestReviewSummaryPanel` | Review summary panel |
| `BacktestTradeDetailDrawer` | Individual trade details |
| `BacktestTradeReplayChart` | Trade replay visualization |

### Trading (17)
| Component | Purpose |
|---|---|
| `TradingWorkspace` | Main trading workspace |
| `TradingAccountConnectionPanel` | MT5 connection status |
| `TradingAccountReadinessPanel` | Account readiness checks |
| `SignalLiveEligibilityPanel` | Signal deployment eligibility |
| `FailureClassificationPanel` | Trade failure categories |
| `TradingDiscrepancyDrawer` | Account/expected discrepancies |
| `TradeHistoryAuditPanel` | Trade audit log |
| `TradeHistoryAuditDrawer` | Audit detail drawer |
| `TradingIncidentInvestigationRail` | Incident investigation |
| `TradingExecutionRecordRail` | Execution record display |
| `TradingExternalActionAuditPanel` | External action audit |
| `TradingExternalDeploymentPanel` | Deployment controls |
| `SignalVersionInspectorDrawer` | Signal version inspection |
| `PaperDashboard` | Paper trading dashboard |
| `StartPaperTradingWizard` | Paper trading setup wizard |
| `TradeHistoryDetailPage` | Trade history detail |
| `TradeHistoryStandalonePage` | Standalone trade history |

### Indicators (4)
| Component | Purpose |
|---|---|
| `IndicatorSettingsDrawer` | Settings panel |
| `IndicatorTraceDrawer` | Debug/trace panel |
| `IndicatorLogConsole` | Log output console |
| `AlertConfigurationModal` | Alert configuration |

### Admin (5)
| Component | Purpose |
|---|---|
| `AdminMonitoringWorkspace` | System monitoring dashboard |
| `AdminUsersWorkspace` | User administration |
| `AdminIndicatorCatalogWorkspace` | Indicator catalog management |
| `AdminSectionTabs` | Admin page tab navigation |
| `BacktestKnowledgeBase` | Knowledge base UI |

### Reports (3)
| Component | Purpose |
|---|---|
| `ReportsWorkspace` | Main reports workspace |
| `BacktestLeaderboardPanel` | Backtest leaderboard |
| `PortfolioBacktestWorkspace` | Portfolio backtest analysis |

### UI Primitives (6)
| Component | Purpose |
|---|---|
| `FactCard` | Fact/stat display card |
| `MetricCard` | Metric display card |
| `SectionCard` | Section container card |
| `Sparkline` | Mini sparkline chart |
| `StateBanner` | State/status banner |
| `SyncStatus` | Sync status indicator |

### Public (2)
| Component | Purpose |
|---|---|
| `PublicReports` | Public reports display |
| `PublicTradeHistory` | Public trade history |

### Docs & Engine (2)
| Component | Purpose |
|---|---|
| `DocsWorkspace` | Documentation workspace |
| `EngineWorkspace` | Engine workspace |

## Hooks (22)

| Hook | Purpose |
|---|---|
| `useAuthSession` | Current user session |
| `useFeatureFlag` | Feature flags |
| `useTradingFeatureFlags` | Trading-specific feature flags |
| `useMarketStore` | Market state (symbol, timeframe) |
| `useIndicators` | Indicator data fetching |
| `useChartEngine` | Chart engine init & management |
| `useTechIndicators` | Technical indicators |
| `useAppLocale` | Application locale |
| `useRsiSettings` | RSI indicator settings |
| `useSignalVersionContext` | Signal version state |
| `useSignalLiveEligibility` | Signal deployment eligibility |
| `useTradingAccounts` | Trading account list |
| `useTradingAccountReadiness` | Account readiness status |
| `useTradingWorkspaceAccount` | Active workspace account |
| `useIndicatorOverlays` | Indicator overlay management |
| `useTradingDiagnosis` | Diagnosis data |
| `useTradingDiscrepancy` | Account discrepancies |
| `useFailureClassification` | Failure classification |
| `useTradeHistoryAudit` | Trade history audit |
| `useTradeHistoryAuditRecordDetail` | Audit record detail |
| `useTradingExternalActions` | External action data |
| `useBacktestProgress` | Backtest progress tracking |
| `useSocket` | Socket.IO connection |

## Stores (6 Zustand)

| Store | State | Persistence |
|---|---|---|
| `useAuthStore` | status, accessToken, session, error | Memory |
| `useMarketStore` | symbol, timeframe | Memory |
| `useConnectionStatus` | socket connection state | Memory |
| `useLocaleStore` | locale (en/vi) | localStorage |
| `useDataFreshness` | freshness timestamps | Memory |
| `useFeatureStore` | feature flags | Memory |
