export type TradingFeatureFlagKey =
    | 'trading_read_enabled'
    | 'trading_write_enabled'
    | 'trading_automation_enabled';

export type TradingCapabilityTier = 'read' | 'write' | 'automation';

export interface TradingFeatureFlags {
    trading_read_enabled: boolean;
    trading_write_enabled: boolean;
    trading_automation_enabled: boolean;
}

export interface TradingCapabilitySnapshot {
    tier: TradingCapabilityTier;
    flagKey: TradingFeatureFlagKey;
    requested: boolean;
    enabled: boolean;
    blockedBy: TradingFeatureFlagKey[];
    title: string;
    reason: string;
}

export interface TradingFeatureFlagSnapshot {
    evaluatedAt: string;
    flags: TradingFeatureFlags;
    capabilities: Record<TradingCapabilityTier, TradingCapabilitySnapshot>;
    highestEnabledTier: TradingCapabilityTier | 'none';
}

export interface TradingFeatureFlagSnapshotOptions {
    accountMode?: 'LIVE' | 'PAPER' | null;
}

const parseBoolean = (value: string | undefined): boolean => {
    if (!value) return false;

    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
};

export const readTradingFeatureFlags = (
    env: NodeJS.ProcessEnv = process.env,
): TradingFeatureFlags => ({
    trading_read_enabled: parseBoolean(env.FEATURE_TRADING_READ),
    trading_write_enabled: parseBoolean(env.FEATURE_TRADING_WRITE),
    trading_automation_enabled: parseBoolean(env.FEATURE_TRADING_AUTO),
});

const createCapabilitySnapshot = ({
    tier,
    flagKey,
    requested,
    enabled,
    blockedBy,
    title,
    reason,
}: {
    tier: TradingCapabilityTier;
    flagKey: TradingFeatureFlagKey;
    requested: boolean;
    enabled: boolean;
    blockedBy: TradingFeatureFlagKey[];
    title: string;
    reason: string;
}): TradingCapabilitySnapshot => ({
    tier,
    flagKey,
    requested,
    enabled,
    blockedBy,
    title,
    reason,
});

export const buildTradingFeatureFlagSnapshot = (
    flags: TradingFeatureFlags = readTradingFeatureFlags(),
    evaluatedAt = new Date().toISOString(),
    options: TradingFeatureFlagSnapshotOptions = {},
): TradingFeatureFlagSnapshot => {
    const accountMode = options.accountMode ?? null;
    const paperOverrideActive = accountMode === 'PAPER';
    const effectiveWriteRequested = flags.trading_write_enabled || paperOverrideActive;
    const effectiveAutomationRequested = flags.trading_automation_enabled || paperOverrideActive;
    const readEnabled = flags.trading_read_enabled;
    const writeEnabled = readEnabled && effectiveWriteRequested;
    const automationEnabled = writeEnabled && effectiveAutomationRequested;

    const read = createCapabilitySnapshot({
        tier: 'read',
        flagKey: 'trading_read_enabled',
        requested: flags.trading_read_enabled,
        enabled: readEnabled,
        blockedBy: readEnabled ? [] : ['trading_read_enabled'],
        title: readEnabled ? 'Read tier enabled' : 'Read tier blocked',
        reason: readEnabled
            ? 'Trading review surfaces can open in read-only mode without exposing write or automation actions.'
            : 'Trading read capability is disabled at runtime. Live eligibility, account readiness, and operational review remain locked until FEATURE_TRADING_READ is enabled.',
    });

    const writeBlockedBy: TradingFeatureFlagKey[] = [];
    if (!flags.trading_read_enabled) {
        writeBlockedBy.push('trading_read_enabled');
    }
    if (!effectiveWriteRequested) {
        writeBlockedBy.push('trading_write_enabled');
    }

    const write = createCapabilitySnapshot({
        tier: 'write',
        flagKey: 'trading_write_enabled',
        requested: effectiveWriteRequested,
        enabled: writeEnabled,
        blockedBy: writeEnabled ? [] : writeBlockedBy,
        title: writeEnabled ? 'Write tier enabled' : 'Write tier blocked',
        reason: writeEnabled
            ? paperOverrideActive && !flags.trading_write_enabled
                ? 'Paper/demo account override enabled manual write-capable trading flows even while FEATURE_TRADING_WRITE stays off for live accounts.'
                : 'Manual write-capable trading flows may proceed through server-side preflight checks.'
            : !flags.trading_read_enabled
                ? 'Trading write capability cannot open because the read tier is off. Enable FEATURE_TRADING_READ before any live activation or command path can be exposed.'
                : 'Trading write capability is disabled at runtime. Manual activation and command submission stop before commitment until FEATURE_TRADING_WRITE is enabled.',
    });

    const automationBlockedBy: TradingFeatureFlagKey[] = [];
    if (!flags.trading_read_enabled) {
        automationBlockedBy.push('trading_read_enabled');
    }
    if (!effectiveWriteRequested) {
        automationBlockedBy.push('trading_write_enabled');
    }
    if (!effectiveAutomationRequested) {
        automationBlockedBy.push('trading_automation_enabled');
    }

    const automation = createCapabilitySnapshot({
        tier: 'automation',
        flagKey: 'trading_automation_enabled',
        requested: effectiveAutomationRequested,
        enabled: automationEnabled,
        blockedBy: automationEnabled ? [] : automationBlockedBy,
        title: automationEnabled ? 'Automation tier enabled' : 'Automation tier blocked',
        reason: automationEnabled
            ? paperOverrideActive && !flags.trading_automation_enabled
                ? 'Paper/demo account override enabled automation controls even while FEATURE_TRADING_AUTO stays off for live accounts.'
                : 'Automation controls may proceed because read and write tiers are already open.'
            : !flags.trading_read_enabled
                ? 'Trading automation stays blocked because the read tier is off. Runtime gating prevents automated execution paths from appearing before basic trading visibility is allowed.'
                : !effectiveWriteRequested
                    ? 'Trading automation stays blocked because the write tier is off. Enable FEATURE_TRADING_WRITE before automation can be considered.'
                    : 'Trading automation is disabled at runtime. Automation control surfaces remain blocked until FEATURE_TRADING_AUTO is enabled.',
    });

    const highestEnabledTier = automation.enabled
        ? 'automation'
        : write.enabled
            ? 'write'
            : read.enabled
                ? 'read'
                : 'none';

    return {
        evaluatedAt,
        flags,
        capabilities: {
            read,
            write,
            automation,
        },
        highestEnabledTier,
    };
};
