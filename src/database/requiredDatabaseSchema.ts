import { PrismaClient } from '@prisma/client';

type RequiredDatabaseColumn = {
    tableName: string;
    columnName: string;
    migrationPath: string;
};

type DatabaseSchemaRow = {
    table_name: string;
    column_name: string;
};

type PersistenceError = Error & {
    code?: string;
    meta?: {
        column?: unknown;
        table?: unknown;
    };
};

const REQUIRED_DATABASE_COLUMNS: RequiredDatabaseColumn[] = [
    {
        tableName: 'price_candles',
        columnName: 'time',
        migrationPath: 'prisma/migrations/20260312234500_add_price_candles_foundation/migration.sql',
    },
    {
        tableName: 'signal_definitions',
        columnName: 'composed_blocks',
        migrationPath: 'prisma/migrations/20260311220000_add_indicator_runtime_foundation/migration.sql',
    },
    {
        tableName: 'signal_definitions',
        columnName: 'is_composed',
        migrationPath: 'prisma/migrations/20260311220000_add_indicator_runtime_foundation/migration.sql',
    },
    {
        tableName: 'signal_definitions',
        columnName: 'created_by',
        migrationPath: 'prisma/migrations/20260311220000_add_indicator_runtime_foundation/migration.sql',
    },
    {
        tableName: 'signal_events',
        columnName: 'indicator_instance_id',
        migrationPath: 'prisma/migrations/20260311220000_add_indicator_runtime_foundation/migration.sql',
    },
    {
        tableName: 'signal_logic_traces',
        columnName: 'indicator_instance_id',
        migrationPath: 'prisma/migrations/20260311220000_add_indicator_runtime_foundation/migration.sql',
    },
    {
        tableName: 'indicator_instances',
        columnName: 'id',
        migrationPath: 'prisma/migrations/20260311220000_add_indicator_runtime_foundation/migration.sql',
    },
    {
        tableName: 'indicator_alerts',
        columnName: 'id',
        migrationPath: 'prisma/migrations/20260311220000_add_indicator_runtime_foundation/migration.sql',
    },
    {
        tableName: 'tech_indicator_definitions',
        columnName: 'runtime_binding_key',
        migrationPath: 'prisma/migrations/20260313100000_add_indicator_catalog_governance/migration.sql',
    },
    {
        tableName: 'tech_indicator_definitions',
        columnName: 'draft_name',
        migrationPath: 'prisma/migrations/20260313153000_add_indicator_catalog_draft_overlay/migration.sql',
    },
    {
        tableName: 'tech_indicator_definitions',
        columnName: 'draft_category',
        migrationPath: 'prisma/migrations/20260313153000_add_indicator_catalog_draft_overlay/migration.sql',
    },
    {
        tableName: 'tech_indicator_definitions',
        columnName: 'draft_description',
        migrationPath: 'prisma/migrations/20260313153000_add_indicator_catalog_draft_overlay/migration.sql',
    },
    {
        tableName: 'tech_indicator_definitions',
        columnName: 'draft_param_schema',
        migrationPath: 'prisma/migrations/20260313153000_add_indicator_catalog_draft_overlay/migration.sql',
    },
    {
        tableName: 'tech_indicator_definitions',
        columnName: 'draft_conditions',
        migrationPath: 'prisma/migrations/20260313153000_add_indicator_catalog_draft_overlay/migration.sql',
    },
    {
        tableName: 'tech_indicator_definitions',
        columnName: 'draft_runtime_binding_key',
        migrationPath: 'prisma/migrations/20260313153000_add_indicator_catalog_draft_overlay/migration.sql',
    },
    {
        tableName: 'tech_indicator_definitions',
        columnName: 'catalog_status',
        migrationPath: 'prisma/migrations/20260313100000_add_indicator_catalog_governance/migration.sql',
    },
    {
        tableName: 'tech_indicator_definitions',
        columnName: 'created_by',
        migrationPath: 'prisma/migrations/20260313100000_add_indicator_catalog_governance/migration.sql',
    },
    {
        tableName: 'tech_indicator_definitions',
        columnName: 'updated_at',
        migrationPath: 'prisma/migrations/20260313100000_add_indicator_catalog_governance/migration.sql',
    },
    {
        tableName: 'tech_indicator_definitions',
        columnName: 'updated_by',
        migrationPath: 'prisma/migrations/20260313100000_add_indicator_catalog_governance/migration.sql',
    },
    {
        tableName: 'tech_indicator_definitions',
        columnName: 'draft_updated_at',
        migrationPath: 'prisma/migrations/20260313153000_add_indicator_catalog_draft_overlay/migration.sql',
    },
    {
        tableName: 'tech_indicator_definitions',
        columnName: 'draft_updated_by',
        migrationPath: 'prisma/migrations/20260313153000_add_indicator_catalog_draft_overlay/migration.sql',
    },
    {
        tableName: 'tech_indicator_definitions',
        columnName: 'published_at',
        migrationPath: 'prisma/migrations/20260313100000_add_indicator_catalog_governance/migration.sql',
    },
    {
        tableName: 'tech_indicator_definitions',
        columnName: 'published_by',
        migrationPath: 'prisma/migrations/20260313100000_add_indicator_catalog_governance/migration.sql',
    },
    {
        tableName: 'tech_indicator_definitions',
        columnName: 'retired_at',
        migrationPath: 'prisma/migrations/20260313100000_add_indicator_catalog_governance/migration.sql',
    },
    {
        tableName: 'tech_indicator_definitions',
        columnName: 'retired_by',
        migrationPath: 'prisma/migrations/20260313100000_add_indicator_catalog_governance/migration.sql',
    },
    {
        tableName: 'users',
        columnName: 'active_trading_account_id',
        migrationPath: 'prisma/migrations/20260312193000_support_multi_account_active_selection/migration.sql',
    },
    {
        tableName: 'trading_accounts',
        columnName: 'account_mode',
        migrationPath: 'prisma/migrations/20260312220000_add_trading_account_mode_for_paper_trading/migration.sql',
    },
    {
        tableName: 'trading_trade_intents',
        columnName: 'id',
        migrationPath: 'prisma/migrations/20260312233000_add_trading_trade_intents_for_auto_execution_worker/migration.sql',
    },
    {
        tableName: 'trading_execution_commands',
        columnName: 'trade_intent_id',
        migrationPath: 'prisma/migrations/20260312233000_add_trading_trade_intents_for_auto_execution_worker/migration.sql',
    },
];

function describeRequirement(requirement: RequiredDatabaseColumn) {
    return `${requirement.tableName}.${requirement.columnName}`;
}

function buildMigrationHint(requirements: RequiredDatabaseColumn[]) {
    return Array.from(new Set(requirements.map((requirement) => requirement.migrationPath))).join(' and ');
}

export function buildRequiredDatabaseSchemaMessage(requirements: RequiredDatabaseColumn[]) {
    const missingColumns = requirements.map(describeRequirement).join(', ');
    const migrations = buildMigrationHint(requirements);

    return `Database schema is behind the current backend code: missing ${missingColumns}. `
        + `Apply ${migrations} before starting the API.`;
}

export async function assertRequiredDatabaseSchema(
    prisma: Pick<PrismaClient, '$queryRaw'>,
) {
    const rows = await prisma.$queryRaw<Array<DatabaseSchemaRow>>`
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND (
            (table_name = 'price_candles' AND column_name = 'time')
            OR
            (table_name = 'signal_definitions' AND column_name = 'composed_blocks')
            OR (table_name = 'signal_definitions' AND column_name = 'is_composed')
            OR (table_name = 'signal_definitions' AND column_name = 'created_by')
            OR (table_name = 'signal_events' AND column_name = 'indicator_instance_id')
            OR (table_name = 'signal_logic_traces' AND column_name = 'indicator_instance_id')
            OR (table_name = 'indicator_instances' AND column_name = 'id')
            OR (table_name = 'indicator_alerts' AND column_name = 'id')
            OR (table_name = 'tech_indicator_definitions' AND column_name = 'runtime_binding_key')
            OR (table_name = 'tech_indicator_definitions' AND column_name = 'draft_name')
            OR (table_name = 'tech_indicator_definitions' AND column_name = 'draft_category')
            OR (table_name = 'tech_indicator_definitions' AND column_name = 'draft_description')
            OR (table_name = 'tech_indicator_definitions' AND column_name = 'draft_param_schema')
            OR (table_name = 'tech_indicator_definitions' AND column_name = 'draft_conditions')
            OR (table_name = 'tech_indicator_definitions' AND column_name = 'draft_runtime_binding_key')
            OR (table_name = 'tech_indicator_definitions' AND column_name = 'catalog_status')
            OR (table_name = 'tech_indicator_definitions' AND column_name = 'created_by')
            OR (table_name = 'tech_indicator_definitions' AND column_name = 'updated_at')
            OR (table_name = 'tech_indicator_definitions' AND column_name = 'updated_by')
            OR (table_name = 'tech_indicator_definitions' AND column_name = 'draft_updated_at')
            OR (table_name = 'tech_indicator_definitions' AND column_name = 'draft_updated_by')
            OR (table_name = 'tech_indicator_definitions' AND column_name = 'published_at')
            OR (table_name = 'tech_indicator_definitions' AND column_name = 'published_by')
            OR (table_name = 'tech_indicator_definitions' AND column_name = 'retired_at')
            OR (table_name = 'tech_indicator_definitions' AND column_name = 'retired_by')
            OR (table_name = 'users' AND column_name = 'active_trading_account_id')
            OR (table_name = 'trading_accounts' AND column_name = 'account_mode')
            OR (table_name = 'trading_trade_intents' AND column_name = 'id')
            OR (table_name = 'trading_execution_commands' AND column_name = 'trade_intent_id')
          )
    `;

    const existingKeys = new Set(rows.map((row) => `${row.table_name}.${row.column_name}`));
    const missingRequirements = REQUIRED_DATABASE_COLUMNS.filter(
        (requirement) => !existingKeys.has(describeRequirement(requirement)),
    );

    if (missingRequirements.length > 0) {
        throw new Error(buildRequiredDatabaseSchemaMessage(missingRequirements));
    }
}

export function getDatabaseSchemaMismatchMessage(error: unknown): string | null {
    const candidate = error as PersistenceError;
    const code = typeof candidate?.code === 'string' ? candidate.code : null;
    const message = error instanceof Error ? error.message : '';
    const referencedColumn = typeof candidate?.meta?.column === 'string' ? candidate.meta.column : null;
    const referencedTable = typeof candidate?.meta?.table === 'string' ? candidate.meta.table : null;

    if (code !== 'P2021' && code !== 'P2022' && !message) {
        return null;
    }

    const missingRequirements = REQUIRED_DATABASE_COLUMNS.filter((requirement) => {
        const columnReferences = [
            describeRequirement(requirement),
            `public.${describeRequirement(requirement)}`,
        ];
        const tableReferences = [
            requirement.tableName,
            `public.${requirement.tableName}`,
        ];

        const matchesColumnReference = columnReferences.some((reference) => (
            (referencedColumn ? referencedColumn.includes(reference) : false)
            || message.includes(reference)
        ));

        if (matchesColumnReference) {
            return true;
        }

        if (code === 'P2021' || referencedTable) {
            return tableReferences.some((reference) => (
                (referencedTable ? referencedTable.includes(reference) : false)
                || message.includes(reference)
            ));
        }

        return false;
    });

    if (missingRequirements.length === 0) {
        return null;
    }

    return buildRequiredDatabaseSchemaMessage(missingRequirements);
}
