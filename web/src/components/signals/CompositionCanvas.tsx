'use client';

import React from 'react';
import { X, GripVertical, ChevronDown, ChevronUp, Settings2 } from 'lucide-react';
import { useAppLocale } from '@/hooks/useAppLocale';
import {
    ComposedBlockConfig,
    ComposedMatchMode,
    TechIndicatorDefinition,
    TechIndicatorFieldSchema,
} from '@/types/signals';

interface Props {
    blocks: ComposedBlockConfig[];
    indicators: TechIndicatorDefinition[];
    matchMode: ComposedMatchMode;
    windowBars: number;
    onRemoveBlock: (id: string) => void;
    onUpdateBlock: (id: string, patch: Partial<ComposedBlockConfig>) => void;
    onMoveBlock: (id: string, direction: 'up' | 'down') => void;
}

function ParamEditor({
    schema,
    values,
    onChange,
}: {
    schema: TechIndicatorFieldSchema[];
    values: Record<string, unknown>;
    onChange: (key: string, value: unknown) => void;
}) {
    if (schema.length === 0) return null;

    return (
        <div className="mt-2 flex flex-wrap gap-3">
            {schema.map(field => (
                <label key={field.id} className="flex flex-col gap-0.5 min-w-[80px]">
                    <span className="text-[9px] text-text-muted uppercase tracking-wider">{field.label}</span>
                    {field.type === 'select' ? (
                        <select
                            value={String(values[field.id] ?? field.default ?? '')}
                            onChange={e => onChange(field.id, e.target.value)}
                            className="bg-bg-primary border border-border-muted rounded px-1.5 py-0.5 text-xs text-text-primary focus:border-accent outline-none"
                        >
                            {(field.options ?? []).map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                    ) : field.type === 'boolean' ? (
                        <input
                            type="checkbox"
                            checked={Boolean(values[field.id] ?? field.default)}
                            onChange={e => onChange(field.id, e.target.checked)}
                            className="accent-accent mt-1"
                        />
                    ) : field.type === 'string' ? (
                        <input
                            type="text"
                            value={String(values[field.id] ?? field.default ?? '')}
                            onChange={e => onChange(field.id, e.target.value)}
                            className="bg-bg-primary border border-border-muted rounded px-1.5 py-0.5 text-xs text-text-primary min-w-[9rem] focus:border-accent outline-none"
                        />
                    ) : (
                        <input
                            type="number"
                            value={String(values[field.id] ?? field.default ?? '')}
                            min={field.min}
                            max={field.max}
                            step={field.step}
                            onChange={e => onChange(field.id, Number(e.target.value))}
                            className="bg-bg-primary border border-border-muted rounded px-1.5 py-0.5 text-xs text-text-primary w-20 focus:border-accent outline-none"
                        />
                    )}
                </label>
            ))}
        </div>
    );
}

export default function CompositionCanvas({
    blocks,
    indicators,
    matchMode,
    windowBars,
    onRemoveBlock,
    onUpdateBlock,
    onMoveBlock,
}: Props) {
    const [expandedParams, setExpandedParams] = React.useState<Set<string>>(new Set());
    const { copy } = useAppLocale();
    const matchModeLabels: Record<ComposedMatchMode, string> = copy.compositionCanvas.matchMode;

    const toggleParams = (id: string) => {
        setExpandedParams(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    const getIndicator = (indicatorId: string) =>
        indicators.find(ind => ind.id === indicatorId);

    const getCondition = (indicatorId: string, conditionId: string) =>
        getIndicator(indicatorId)?.conditions.find(c => c.id === conditionId);

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            {/* Match mode banner */}
            <div className="px-4 py-2 border-b border-border-muted bg-accent/5 shrink-0 flex items-center gap-3">
                <Settings2 size={14} className="text-accent shrink-0" />
                <span className="text-[11px] text-accent font-semibold">
                    {matchModeLabels[matchMode]}
                </span>
                {matchMode !== 'ANY' && (
                    <span className="text-[11px] text-text-muted">
                        / {copy.compositionCanvas.windowLabel} <span className="text-text-primary font-mono">{windowBars}</span> {copy.compositionCanvas.barsLabel}
                    </span>
                )}
            </div>

            {/* Canvas body */}
            <div className="flex-1 overflow-y-auto p-4">
                {blocks.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-text-muted space-y-3">
                        <div className="w-16 h-16 rounded-2xl border-2 border-dashed border-border-muted flex items-center justify-center">
                            <Settings2 size={24} className="opacity-30" />
                        </div>
                        <p className="text-sm">{copy.compositionCanvas.emptyPrompt}</p>
                    </div>
                ) : (
                    <div className="space-y-3 max-w-2xl mx-auto">
                        {matchMode === 'SEQUENCE' && blocks.length > 0 && (
                            <p className="text-[10px] text-text-muted text-center italic mb-1">
                                {copy.compositionCanvas.sequenceHint}
                            </p>
                        )}

                        {blocks.map((block, idx) => {
                            const indicator = getIndicator(block.indicatorId);
                            const condition = getCondition(block.indicatorId, block.conditionId);
                            const isParamsOpen = expandedParams.has(block.id);
                            const hasParams =
                                (indicator?.paramSchema?.length ?? 0) > 0 ||
                                (condition?.paramSchema?.length ?? 0) > 0;

                            return (
                                <div key={block.id}>
                                    {/* Sequence connector */}
                                    {matchMode === 'SEQUENCE' && idx > 0 && (
                                        <div className="flex items-center justify-center gap-2 my-1">
                                            <div className="h-px flex-1 bg-border-muted/50" />
                                            <span className="text-[9px] text-text-muted uppercase tracking-widest px-2">{copy.compositionCanvas.then}</span>
                                            <div className="h-px flex-1 bg-border-muted/50" />
                                        </div>
                                    )}

                                    <div className="bg-bg-tertiary border border-border-muted rounded-xl overflow-hidden hover:border-accent/30 transition-colors">
                                        <div className="flex items-center gap-2 px-3 py-2.5">
                                            {/* Drag handle (visual only) */}
                                            <GripVertical size={14} className="text-border-muted shrink-0 cursor-grab" />

                                            {/* Sequence number */}
                                            {matchMode === 'SEQUENCE' && (
                                                <span className="text-[9px] font-black text-accent bg-accent/10 border border-accent/20 rounded px-1.5 py-0.5 shrink-0">
                                                    #{idx + 1}
                                                </span>
                                            )}

                                            {/* Indicator badge */}
                                            <span className="text-[9px] font-black text-blue-400 bg-blue-500/10 border border-blue-500/20 rounded px-1.5 py-0.5 shrink-0 font-mono">
                                                {block.indicatorId}
                                            </span>

                                            {/* Condition name */}
                                            <div className="flex-1 min-w-0">
                                                <div className="text-sm font-semibold text-text-primary leading-tight truncate">
                                                    {condition?.name ?? block.conditionId}
                                                </div>
                                                {condition?.description && (
                                                    <div className="text-[10px] text-text-muted truncate">
                                                        {condition.description}
                                                    </div>
                                                )}
                                            </div>

                                            {/* Actions */}
                                            <div className="flex items-center gap-1 shrink-0">
                                                {matchMode === 'SEQUENCE' && (
                                                    <>
                                                        <button
                                                            onClick={() => onMoveBlock(block.id, 'up')}
                                                            disabled={idx === 0}
                                                            className="p-1 rounded hover:bg-white/10 text-text-muted disabled:opacity-20 transition-colors"
                                                        >
                                                            <ChevronUp size={14} />
                                                        </button>
                                                        <button
                                                            onClick={() => onMoveBlock(block.id, 'down')}
                                                            disabled={idx === blocks.length - 1}
                                                            className="p-1 rounded hover:bg-white/10 text-text-muted disabled:opacity-20 transition-colors"
                                                        >
                                                            <ChevronDown size={14} />
                                                        </button>
                                                    </>
                                                )}
                                                {hasParams && (
                                                    <button
                                                        onClick={() => toggleParams(block.id)}
                                                        className={`p-1 rounded transition-colors ${isParamsOpen ? 'text-accent bg-accent/10' : 'text-text-muted hover:bg-white/10'}`}
                                                        title={copy.compositionCanvas.editParameters}
                                                    >
                                                        <Settings2 size={13} />
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => onRemoveBlock(block.id)}
                                                    className="p-1 rounded hover:bg-price-down/20 text-text-muted hover:text-price-down transition-colors"
                                                >
                                                    <X size={14} />
                                                </button>
                                            </div>
                                        </div>

                                        {/* Params editor */}
                                        {isParamsOpen && (
                                            <div className="px-4 py-3 border-t border-border-muted bg-bg-primary/40 space-y-3">
                                                {(indicator?.paramSchema?.length ?? 0) > 0 && (
                                                    <div>
                                                        <div className="text-[9px] text-text-muted uppercase tracking-widest mb-1 font-bold">
                                                            {copy.compositionCanvas.indicatorParams}
                                                        </div>
                                                        <ParamEditor
                                                            schema={indicator!.paramSchema}
                                                            values={block.indicatorParams}
                                                            onChange={(key, val) =>
                                                                onUpdateBlock(block.id, {
                                                                    indicatorParams: { ...block.indicatorParams, [key]: val },
                                                                })
                                                            }
                                                        />
                                                    </div>
                                                )}
                                                {(condition?.paramSchema?.length ?? 0) > 0 && (
                                                    <div>
                                                        <div className="text-[9px] text-text-muted uppercase tracking-widest mb-1 font-bold">
                                                            {copy.compositionCanvas.conditionParams}
                                                        </div>
                                                        <ParamEditor
                                                            schema={condition!.paramSchema}
                                                            values={block.conditionParams}
                                                            onChange={(key, val) =>
                                                                onUpdateBlock(block.id, {
                                                                    conditionParams: { ...block.conditionParams, [key]: val },
                                                                })
                                                            }
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
