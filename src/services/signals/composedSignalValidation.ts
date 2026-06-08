import { TechIndicatorRegistry } from './blocks/TechIndicatorRegistry';
import { ComposedSignalDefinition } from './ComposedSignalPlugin';

export type ComposedSignalValidationSection = 'entry' | 'protection' | 'exit';

export interface ComposedSignalValidationIssue {
    field: string;
    section: ComposedSignalValidationSection;
    message: string;
}

const EXIT_PROFILE_CODES = new Set([
    'HARD_SIGNAL_TP',
    'FIXED_2R',
    'BE_1R_TP_2R',
    'PARTIAL_1R_BE_R3',
    'BE_1R_TRAIL_2R_3R',
    'BE_1R_PARTIAL_2R_TRAIL',
    'PARTIAL_1R_BE_SWING_TRAIL',
    'XAU_NY_CLOSE',
    'TIME_24',
]);

const buildValidationMessage = (issues: ComposedSignalValidationIssue[]) => (
    `Validation failed:\n${issues.map((issue) => `- ${issue.message}`).join('\n')}`
);

export class ComposedSignalValidationError extends Error {
    public readonly code = 'VALIDATION_FAILED';

    constructor(public readonly issues: ComposedSignalValidationIssue[]) {
        super(buildValidationMessage(issues));
        this.name = 'ComposedSignalValidationError';
    }
}

export function validateComposedSignalDefinition(
    definition: ComposedSignalDefinition,
    blockRegistry: TechIndicatorRegistry,
): ComposedSignalValidationIssue[] {
    const issues: ComposedSignalValidationIssue[] = [];

    if (!definition.blocks || definition.blocks.length === 0) {
        issues.push({
            field: 'blocks',
            section: 'entry',
            message: 'Add at least 1 condition before saving this signal.',
        });
    }

    if (!['ALL', 'ANY', 'SEQUENCE'].includes(definition.matchMode)) {
        issues.push({
            field: 'matchMode',
            section: 'entry',
            message: 'Entry conditions must combine as ALL, ANY, or SEQUENCE.',
        });
    }

    if (!Number.isInteger(definition.windowBars) || definition.windowBars < 1) {
        issues.push({
            field: 'windowBars',
            section: 'entry',
            message: 'Entry confirmation window must be a whole number of at least 1 bar.',
        });
    }

    const signalAreaGuard = definition.entryManagement?.signalAreaGuard;
    if (signalAreaGuard) {
        if (!Number.isInteger(signalAreaGuard.maxSignalsPerArea) || signalAreaGuard.maxSignalsPerArea < 1) {
            issues.push({
                field: 'signalAreaGuardMaxSignalsPerArea',
                section: 'entry',
                message: 'Signal-area cap must allow at least 1 signal per area.',
            });
        }

        if (signalAreaGuard.resetBars !== undefined && (!Number.isInteger(signalAreaGuard.resetBars) || signalAreaGuard.resetBars < 1)) {
            issues.push({
                field: 'signalAreaGuardResetBars',
                section: 'entry',
                message: 'Signal-area reset bars must be a whole number of at least 1 bar.',
            });
        }

        if (signalAreaGuard.priceDistanceR !== undefined && (
            typeof signalAreaGuard.priceDistanceR !== 'number'
            || !Number.isFinite(signalAreaGuard.priceDistanceR)
            || signalAreaGuard.priceDistanceR <= 0
        )) {
            issues.push({
                field: 'signalAreaGuardPriceDistanceR',
                section: 'entry',
                message: 'Signal-area price distance must be greater than 0R.',
            });
        }
    }

    if (!['LONG', 'SHORT'].includes(definition.side)) {
        issues.push({
            field: 'side',
            section: 'entry',
            message: 'Signal side must be LONG or SHORT.',
        });
    }

    if (!definition.stopLoss || !['BELOW_STRUCTURE', 'FIXED_PERCENT'].includes(definition.stopLoss.type)) {
        issues.push({
            field: 'stopLossType',
            section: 'protection',
            message: 'Stop-loss method must be BELOW_STRUCTURE or FIXED_PERCENT.',
        });
    } else {
        if (typeof definition.stopLoss.value !== 'number' || !Number.isFinite(definition.stopLoss.value) || definition.stopLoss.value <= 0 || definition.stopLoss.value >= 1) {
            issues.push({
                field: 'stopLossValue',
                section: 'protection',
                message: definition.stopLoss.type === 'BELOW_STRUCTURE'
                    ? 'Structure stop buffer must be stored as a fraction greater than 0 and less than 1.'
                    : 'Fixed stop distance must be stored as a fraction greater than 0 and less than 1.',
            });
        }

        if (definition.stopLoss.type === 'BELOW_STRUCTURE' && (!Number.isInteger(definition.stopLoss.lookback) || (definition.stopLoss.lookback ?? 0) < 1)) {
            issues.push({
                field: 'stopLossLookback',
                section: 'protection',
                message: 'Structure stop lookback must be a whole number of at least 1 bar.',
            });
        }

        if (definition.stopLoss.atrBufferMultiplier !== undefined) {
            if (typeof definition.stopLoss.atrBufferMultiplier !== 'number' || definition.stopLoss.atrBufferMultiplier < 0) {
                issues.push({
                    field: 'atrBufferMultiplier',
                    section: 'protection',
                    message: 'ATR buffer multiplier must be a number greater than or equal to 0.',
                });
            }
        }

        if (definition.stopLoss.atrPeriod !== undefined) {
            if (!Number.isInteger(definition.stopLoss.atrPeriod) || definition.stopLoss.atrPeriod < 1) {
                issues.push({
                    field: 'atrPeriod',
                    section: 'protection',
                    message: 'ATR period must be a whole number of at least 1 bar.',
                });
            }
        }
    }

    if (!definition.takeProfit || !['R_MULTIPLE', 'FIXED_PERCENT'].includes(definition.takeProfit.type)) {
        issues.push({
            field: 'takeProfitType',
            section: 'exit',
            message: 'Take-profit method must be R_MULTIPLE or FIXED_PERCENT.',
        });
    } else if (
        typeof definition.takeProfit.value !== 'number'
        || !Number.isFinite(definition.takeProfit.value)
        || definition.takeProfit.value <= 0
        || (definition.takeProfit.type === 'FIXED_PERCENT' && definition.takeProfit.value >= 1)
    ) {
        issues.push({
            field: 'takeProfitValue',
            section: 'exit',
            message: definition.takeProfit.type === 'FIXED_PERCENT'
                ? 'Fixed take-profit distance must be stored as a fraction greater than 0 and less than 1.'
                : 'Take-profit R multiple must be greater than 0.',
        });
    }

    const exitProfileCode = definition.exitManagement?.profileCode ?? 'HARD_SIGNAL_TP';
    if (!EXIT_PROFILE_CODES.has(exitProfileCode)) {
        issues.push({
            field: 'exitManagementProfile',
            section: 'exit',
            message: 'Exit management profile must use a supported runtime profile code.',
        });
    }

    if (definition.lineage) {
        if (definition.lineage.relationship !== 'REFINEMENT') {
            issues.push({
                field: 'lineageRelationship',
                section: 'entry',
                message: 'Signal lineage must use the REFINEMENT relationship.',
            });
        }

        if (typeof definition.lineage.parentSignalId !== 'string' || definition.lineage.parentSignalId.trim().length === 0) {
            issues.push({
                field: 'lineageParentSignalId',
                section: 'entry',
                message: 'Signal lineage must keep the original signal id.',
            });
        }

        if (typeof definition.lineage.parentCode !== 'string' || definition.lineage.parentCode.trim().length === 0) {
            issues.push({
                field: 'lineageParentCode',
                section: 'entry',
                message: 'Signal lineage must keep the original signal code.',
            });
        }

        if (!Number.isInteger(definition.lineage.parentVersion) || definition.lineage.parentVersion < 1) {
            issues.push({
                field: 'lineageParentVersion',
                section: 'entry',
                message: 'Signal lineage must keep a valid original signal version.',
            });
        }

        if (typeof definition.lineage.parentName !== 'string' || definition.lineage.parentName.trim().length === 0) {
            issues.push({
                field: 'lineageParentName',
                section: 'entry',
                message: 'Signal lineage must keep the original signal name.',
            });
        }
    }

    const blockIds = new Set<string>();
    for (const block of (definition.blocks ?? [])) {
        if (!block.id) {
            issues.push({
                field: 'blocks',
                section: 'entry',
                message: 'Every condition block must include a stable id.',
            });
            continue;
        }

        if (blockIds.has(block.id)) {
            issues.push({
                field: 'blocks',
                section: 'entry',
                message: `Condition block "${block.id}" is duplicated.`,
            });
        }
        blockIds.add(block.id);

        if (!blockRegistry.has(block.indicatorId)) {
            issues.push({
                field: 'blocks',
                section: 'entry',
                message: `Indicator "${block.indicatorId}" is not available in the catalog.`,
            });
            continue;
        }

        const blockDefinition = blockRegistry.get(block.indicatorId);
        const validConditionIds = blockDefinition?.definition.conditions.map((condition) => condition.id) ?? [];
        if (!validConditionIds.includes(block.conditionId)) {
            issues.push({
                field: 'blocks',
                section: 'entry',
                message: `Condition "${block.conditionId}" is not valid for indicator "${block.indicatorId}".`,
            });
        }
    }

    return issues;
}
