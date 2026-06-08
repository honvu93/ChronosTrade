# Database Schema Inventory

Updated: 2026-03-13

## Scope

- Source of truth in code: `prisma/schema.prisma`
- Runtime schema guard: `src/database/requiredDatabaseSchema.ts`
- Live schema checked: PostgreSQL `public` schema referenced by the repo `.env`

## Verification Summary

- Expected application tables from Prisma: 30
- Live DB re-verification after `20260313100000_add_indicator_catalog_governance` is pending; the last full verification before this change was on 2026-03-12
- Infrastructure table also present: `_prisma_migrations`
- Runtime-critical required columns now expected by code: 21
- Migration directories on disk: 15
- Applied non-rolled-back migrations in DB before this change: 14
- Missing migrations in DB after this change: `20260313100000_add_indicator_catalog_governance` until it is applied
- Historical note: `_prisma_migrations` contains one rolled-back record for `20260312010000_add_mt5_trading_workspace_foundation`, and the same migration also exists later as a successful applied record.

## Application Tables

### Market Data

| Table | Columns |
| --- | --- |
| `price_candles` | `time`, `symbol`, `timeframe`, `exchange`, `open`, `high`, `low`, `close`, `volume`, `quote_volume`, `trades`, `taker_buy_volume`, `is_closed` |

### Signal, Indicator, and Backtest

| Table | Columns |
| --- | --- |
| `strategies` | `id`, `code`, `name`, `description`, `is_active`, `created_at`, `updated_at` |
| `exit_rules` | `id`, `code`, `name`, `description`, `config_json`, `is_active`, `created_at`, `updated_at` |
| `signals` | `id`, `symbol`, `timeframe`, `side`, `strategy_id`, `session`, `entry_time`, `entry_price`, `stop_loss`, `take_profit_1`, `take_profit_2`, `invalidation_price`, `notes`, `created_at`, `updated_at`, `backtest_run_id`, `source_type`, `definition_code`, `definition_version`, `execution_config_json`, `external_key` |
| `backtest_runs` | `id`, `name`, `symbol`, `timeframe`, `strategy_id`, `side`, `initial_equity`, `risk_percent`, `notes`, `started_at`, `finished_at`, `created_at`, `updated_at`, `source_type`, `status`, `signal_code`, `signal_version`, `parameters_json`, `execution_config_json`, `error_message` |
| `backtest_trade_results` | `id`, `backtest_run_id`, `signal_id`, `exit_rule_id`, `result_side`, `session`, `win`, `is_open`, `r_multiple`, `pnl_usd`, `max_drawdown_pct`, `exit_reason`, `exit_time`, `exit_price`, `notes`, `created_at`, `updated_at` |
| `signal_definitions` | `id`, `code`, `version`, `name`, `category`, `description`, `parameter_schema`, `indicator_schema`, `event_schema`, `is_active`, `created_at`, `updated_at`, `composed_blocks`, `is_composed`, `created_by` |
| `tech_indicator_definitions` | `id`, `name`, `category`, `description`, `param_schema`, `conditions`, `runtime_binding_key`, `catalog_status`, `is_active`, `created_by`, `created_at`, `updated_at`, `updated_by`, `published_at`, `published_by`, `retired_at`, `retired_by` |
| `signal_events` | `id`, `signal_id`, `backtest_run_id`, `event_type`, `candle_time`, `price`, `label`, `meta_json`, `created_at`, `indicator_instance_id` |
| `signal_logic_traces` | `id`, `signal_id`, `signal_event_id`, `backtest_run_id`, `event_type`, `candle_time`, `state_before`, `state_after`, `rule_id`, `indicator_json`, `threshold_json`, `price_json`, `notes`, `created_at`, `indicator_instance_id` |
| `indicator_instances` | `id`, `name`, `status`, `source_backtest_run_id`, `signal_code`, `signal_version`, `symbol`, `timeframe`, `parameter_json`, `execution_config_json`, `last_processed_candle_time`, `last_emitted_event_time`, `state_json`, `state_version`, `error_message`, `started_at`, `stopped_at`, `created_at`, `updated_at` |
| `indicator_alerts` | `id`, `instance_id`, `type`, `condition_json`, `is_active`, `last_triggered_at`, `created_at`, `updated_at` |
| `signal_optimization_jobs` | `id`, `signal_code`, `signal_version`, `symbol`, `timeframe`, `started_at`, `finished_at`, `execution_config_json`, `parameter_space_json`, `ranking_config_json`, `status`, `error_message`, `created_at`, `updated_at` |
| `signal_optimization_runs` | `id`, `optimization_job_id`, `backtest_run_id`, `parameter_set_json`, `ranking_score`, `rank_order`, `created_at` |

### Auth and Trading Workspace

| Table | Columns |
| --- | --- |
| `users` | `id`, `email`, `username`, `display_name`, `password_hash`, `password_salt`, `role`, `is_active`, `created_at`, `updated_at`, `active_trading_account_id` |
| `user_module_access` | `id`, `user_id`, `module`, `created_at` |
| `trading_accounts` | `id`, `owner_user_id`, `label`, `created_at`, `updated_at`, `broker_kind`, `status`, `base_currency`, `leverage`, `last_seen_at`, `last_successful_sync_at`, `metadata_json`, `account_mode` |
| `mt5_credentials` | `id`, `trading_account_id`, `ciphertext`, `created_at`, `updated_at` |
| `trading_sync_runs` | `id`, `account_id`, `sync_kind`, `status`, `requested_by_user_id`, `started_at`, `finished_at`, `summary_json`, `error_code`, `error_message`, `created_at` |
| `trading_account_snapshots` | `id`, `account_id`, `captured_at`, `balance`, `equity`, `margin`, `free_margin`, `margin_level`, `unrealized_pnl`, `realized_pnl_day`, `metadata_json`, `created_at` |

### Trading Execution, Automation, and Audit

| Table | Columns |
| --- | --- |
| `trading_positions` | `id`, `account_id`, `broker_position_id`, `broker_order_id`, `symbol`, `side`, `volume`, `open_price`, `stop_loss`, `take_profit`, `current_price`, `swap`, `commission`, `unrealized_pnl`, `opened_at`, `closed_at`, `status`, `last_synced_at`, `raw_broker_json`, `created_at`, `updated_at` |
| `trading_orders` | `id`, `account_id`, `broker_order_id`, `related_position_broker_id`, `symbol`, `side`, `order_type`, `requested_volume`, `filled_volume`, `price`, `stop_loss`, `take_profit`, `status`, `placed_at`, `expires_at`, `last_synced_at`, `raw_broker_json`, `created_at`, `updated_at` |
| `trading_deals` | `id`, `account_id`, `broker_deal_id`, `broker_order_id`, `broker_position_id`, `symbol`, `side`, `volume`, `price`, `commission`, `swap`, `fee`, `realized_pnl`, `executed_at`, `comment`, `raw_broker_json`, `created_at` |
| `trading_execution_commands` | `id`, `account_id`, `requested_by_user_id`, `command_type`, `status`, `idempotency_key`, `symbol`, `side`, `volume`, `price`, `stop_loss`, `take_profit`, `broker_position_id`, `broker_order_id`, `payload_json`, `risk_check_json`, `broker_reference`, `requested_at`, `dispatched_at`, `completed_at`, `reconciled_at`, `error_code`, `error_message`, `created_at`, `updated_at`, `trade_intent_id` |
| `trading_execution_events` | `id`, `command_id`, `event_type`, `occurred_at`, `status_before`, `status_after`, `message`, `payload_json`, `created_at` |
| `trading_automation_bindings` | `id`, `account_id`, `indicator_instance_id`, `name`, `status`, `mode`, `filters_json`, `risk_config_json`, `guardrails_json`, `kill_switch_active`, `approval_required`, `created_by_user_id`, `approved_by_user_id`, `approved_at`, `last_triggered_at`, `status_reason`, `created_at`, `updated_at` |
| `trading_trade_intents` | `id`, `account_id`, `binding_id`, `indicator_instance_id`, `signal_event_id`, `mode`, `status`, `event_type`, `command_type`, `symbol`, `side`, `volume`, `entry_price`, `stop_loss`, `take_profit`, `payload_json`, `status_reason`, `started_at`, `completed_at`, `last_queued_at`, `created_at`, `updated_at` |
| `trading_investigation_outcomes` | `id`, `signal_code`, `signal_version`, `root_cause`, `outcome`, `backtest_run_id`, `indicator_instance_id`, `trade_record_id`, `summary`, `evidence_json`, `created_at` |
| `trading_webhook_endpoints` | `id`, `name`, `url`, `contract_kinds_json`, `bearer_token_ciphertext`, `signing_secret_ciphertext`, `is_active`, `created_at`, `updated_at` |
| `trading_webhook_deliveries` | `id`, `endpoint_id`, `status`, `http_status`, `error_message`, `response_body_text`, `record_count`, `query_json`, `payload_json`, `record_refs_json`, `attempted_at`, `delivered_at`, `created_at` |

## Runtime-Critical Columns Required By Current Code

- `price_candles.time`
- `signal_definitions.composed_blocks`
- `signal_definitions.is_composed`
- `signal_definitions.created_by`
- `signal_events.indicator_instance_id`
- `signal_logic_traces.indicator_instance_id`
- `indicator_instances.id`
- `indicator_alerts.id`
- `tech_indicator_definitions.runtime_binding_key`
- `tech_indicator_definitions.catalog_status`
- `tech_indicator_definitions.created_by`
- `tech_indicator_definitions.updated_at`
- `tech_indicator_definitions.updated_by`
- `tech_indicator_definitions.published_at`
- `tech_indicator_definitions.published_by`
- `tech_indicator_definitions.retired_at`
- `tech_indicator_definitions.retired_by`
- `users.active_trading_account_id`
- `trading_accounts.account_mode`
- `trading_trade_intents.id`
- `trading_execution_commands.trade_intent_id`

## Refresh Procedure

- Compare expected tables against `prisma/schema.prisma`.
- Query `information_schema.tables` and `information_schema.columns` on the active DB from `.env`.
- Check `_prisma_migrations` for applied and rolled-back migration records.
- If schema changes, update this file and the summary block in `project-context.md` in the same change.
