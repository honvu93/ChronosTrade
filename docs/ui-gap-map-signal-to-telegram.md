---
title: UI Gap Map - Signal to Telegram Flow
description: Implementation-ready UI gap map cho flow tu signal definition den external Telegram delivery.
author: Codex
date: 2026-03-13
---

# UI Gap Map: Signal to Telegram Flow

## Muc tieu

Tai lieu nay chuyen ket qua audit UI hien tai thanh mot gap map implementation-ready de doi BA, PM, UI, va dev co the tach story va trien khai ngay.

Flow duoc cover:

1. Signal definition
2. Generated backtest
3. Signal live eligibility
4. Indicator activation
5. Indicator runtime monitoring
6. External deployment
7. External event and delivery audit
8. Telegram output handoff

## Chu thich trang thai

- `Existing`: da co UI va nam trong flow nguoi dung
- `Partial`: da co component/page nhung chua nam trong flow chinh hoac discoverability yeu
- `Missing`: chi co backend hoac chua co UI

## Bang UI Gap Map

| Flow buoc | Trang thai hien tai | Screen can them hoac can noi lai | API dung | Component de xuat | Muc uu tien | Story nen tach |
| --- | --- | --- | --- | --- | --- | --- |
| Surface `Signal Live Eligibility` cho operator | `Partial` - da co component nhung chua mount vao page nao | Them mot section hoac tab `Signal Live Eligibility` trong `/trading` de user co the xem danh sach signal live-eligible, blocking reasons, va `Inspect Version` | `GET /api/trading/operations/signal-eligibility` | Reuse `web/src/components/trading/SignalLiveEligibilityPanel.tsx`; mount trong `web/src/components/trading/TradingWorkspace.tsx`; giu `SignalVersionInspectorDrawer` nhu hien tai | `P1` | `6.7 Surface signal live eligibility in trading workspace` |
| Cau hinh `External Deployment` va Telegram bot | `Missing` - chi co backend route | Them screen `External Deployments` gom form tao deployment, list deployment da tao, va cac action `enable`, `pause`, `archive` | `GET /api/trading/external-actions/deployments`; `POST /api/trading/external-actions/deployments`; `POST /api/trading/external-actions/deployments/:id/enable`; `POST /api/trading/external-actions/deployments/:id/pause`; `POST /api/trading/external-actions/deployments/:id/archive` | Tao moi `web/src/components/trading/TradingExternalDeploymentPanel.tsx`; tach `ExternalDeploymentForm.tsx` va `ExternalDeploymentList.tsx`; them hook `web/src/hooks/useTradingExternalActions.ts` | `P1` | `6.8 Manage external deployments and Telegram configuration` |
| Audit `External Action Events`, `Deliveries`, va `Replay` | `Missing` - chi co backend route | Them screen `External Action Audit` de filter event, xem delivery attempts, trang thai `SENT/FAILED/CANCELED`, va cho phep `Replay` event loi | `GET /api/trading/external-actions/events`; `GET /api/trading/external-actions/deliveries`; `POST /api/trading/external-actions/events/:id/replay` | Tao moi `web/src/components/trading/TradingExternalActionAuditPanel.tsx`; tach `ExternalActionEventTable.tsx`, `ExternalActionDeliveryTable.tsx`, `ExternalActionReplayButton.tsx`; dung chung hook `useTradingExternalActions.ts` | `P2` | `6.9 External action event and delivery audit UI` |
| Handoff sau khi `Activate As Indicator` | `Partial` - user chi nhan success message, khong duoc dan tiep sang buoc sau | Bo sung success banner va action group sau promote: `Open Indicator Dashboard`, `Open Indicator Analyzer`, `Create External Deployment` | `POST /api/indicators/instances/promote`; co the goi them `GET /api/indicators/instances` de refresh va resolve instance moi nhat | Patch `web/src/components/signals/SignalsGenerateWorkspace.tsx`; them `IndicatorActivationSuccessBanner.tsx` neu muon tach nho | `P2` | `6.10 Improve post-promotion operator handoff` |
| Discoverability cua `/indicators` | `Partial` - page ton tai nhung khong co nav item rieng | Bo sung entry point ro rang den `/indicators` tu nav hoac tu `/engine`; dam bao user tim thay indicator dashboard sau khi promote | Khong can API moi; dung hook hien co `useIndicators()` voi `GET /api/indicators/instances` | Patch `web/src/components/layout/navigationModel.ts`; neu can them CTA/card trong `web/src/app/engine/page.tsx` hoac `web/src/components/engine/EngineWorkspace.tsx` | `P3` | `6.11 Surface indicators dashboard in navigation` |

## Pham vi co UI roi va khong can tach thanh story moi

| Flow buoc | Trang thai | UI hien co | Ghi chu |
| --- | --- | --- | --- |
| Signal authoring | `Existing` | `/signals/composer` | Da co create, edit, inspect, reuse, retire, va `Run Backtest` |
| Generated backtest workspace | `Existing` | `/signals` tab `generate` | Da co preview, create run, refresh, delete, open trade history, activate indicator |
| Legacy import and review | `Existing` | `/signals` tab `import` va `review` | Flow song song, khong phai duong chinh cua Telegram lane |
| Backtest detail and trade history | `Existing` | `/signals/backtests/[runId]` | Da co summary, comparison, filters, export, drawer chi tiet, deep-link sang Engine |
| Indicator runtime monitoring | `Existing` | `/indicators` va `/indicators/[id]/chart` | Da co dashboard, analyzer, trace drawer, settings drawer, log console |
| Trading account and internal MT5 automation | `Existing` | `/trading` | Da co account connection/readiness va automation bindings, nhung day la flow MT5 noi bo, khong phai Telegram external action |

## Component topology de xuat

- Hook dung chung:
  - `web/src/hooks/useTradingExternalActions.ts`
  - Tra ve cac action: `listDeployments`, `createDeployment`, `enableDeployment`, `pauseDeployment`, `archiveDeployment`, `listEvents`, `listDeliveries`, `replayEvent`

- Type dung chung:
  - Mo rong `web/src/types/trading.ts` hoac tao file moi `web/src/types/tradingExternalAction.ts`
  - Gom: `ExternalDeploymentView`, `ExternalActionEvent`, `ExternalActionDelivery`, `ExternalReplayJob`

- Vi tri mount de xuat:
  - `/trading`
  - Them tab moi `eligibility`
  - Them tab moi `external-actions`
  - Giu `/signals` cho backtest va activation
  - Giu `/indicators` cho runtime monitoring sau khi promote

## Thu tu trien khai de xuat

1. Mount `SignalLiveEligibilityPanel` vao `/trading`
2. Them `External Deployments` panel
3. Them `External Action Audit` panel
4. Them handoff sau `Activate As Indicator`
5. Them discoverability cho `/indicators`

## Ghi chu implementation

- `SignalLiveEligibilityPanel` da ton tai, nen uu tien 1 la cong viec low-risk nhat.
- `External Deployments` va `External Action Audit` nen dung chung mot hook va mot model type de tranh duplicate envelope parsing.
- Handoff sau promote nen de o ngay `SignalsGenerateWorkspace` vi day la noi user dang dung khi ra quyet dinh activation.
- Discoverability cho `/indicators` khong nen phu thuoc vao promote flow; user van can vao duoc dashboard nay tu navigation thong thuong.
- Khong nen tron `MT5 internal automation bindings` voi `External Telegram deployments` trong cung mot card hoac cung mot form. Hai lane nay giong nhau o dau vao `indicator instance`, nhung muc tieu va API khac nhau.
