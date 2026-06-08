import {
    ComposedSignal,
    ComposedSignalBlocks,
    ComposedSignalLineage,
} from "@/types/signals";
import {
    ComposedSignalLifecycleState,
    getComposedSignalLifecycleState,
} from "./composedSignalLifecycle";

export interface ReusableSignalDraft {
    name: string;
    description: string;
    composedBlocks: ComposedSignalBlocks;
}

export interface SignalReuseConnection {
    id: string;
    name: string;
    code: string;
    version: number;
    lifecycleState: ComposedSignalLifecycleState | null;
    signal: ComposedSignal | null;
}

export interface SignalReuseConnections {
    parent: SignalReuseConnection | null;
    refinements: SignalReuseConnection[];
}

export const buildSignalRefinementLineage = (
    signal: Pick<ComposedSignal, "id" | "code" | "version" | "name">,
): ComposedSignalLineage => ({
    relationship: "REFINEMENT",
    parentSignalId: signal.id,
    parentCode: signal.code,
    parentVersion: signal.version,
    parentName: signal.name,
});

export const buildReusableSignalDraft = (
    signal: ComposedSignal,
    createId: () => string,
): ReusableSignalDraft => ({
    name: `${signal.name} Refinement`,
    description: signal.description ?? "",
    composedBlocks: {
        ...signal.composedBlocks,
        blocks: signal.composedBlocks.blocks.map((block) => ({
            ...block,
            id: createId(),
        })),
        lineage: buildSignalRefinementLineage(signal),
    },
});

const toSignalReuseConnection = (
    signal: ComposedSignal | null,
    fallback: ComposedSignalLineage,
): SignalReuseConnection => ({
    id: signal?.id ?? fallback.parentSignalId,
    name: signal?.name ?? fallback.parentName,
    code: signal?.code ?? fallback.parentCode,
    version: signal?.version ?? fallback.parentVersion,
    lifecycleState: signal ? getComposedSignalLifecycleState(signal) : null,
    signal,
});

export const getSignalReuseConnections = (
    signal: ComposedSignal,
    signals: ComposedSignal[],
): SignalReuseConnections => {
    const parentLineage = signal.composedBlocks.lineage;
    const parentSignal = parentLineage
        ? signals.find((candidate) => candidate.id === parentLineage.parentSignalId) ?? null
        : null;
    const parent = parentLineage
        ? toSignalReuseConnection(parentSignal, parentLineage)
        : null;

    const refinements = signals
        .filter((candidate) => candidate.composedBlocks.lineage?.parentSignalId === signal.id)
        .map((candidate) => ({
            id: candidate.id,
            name: candidate.name,
            code: candidate.code,
            version: candidate.version,
            lifecycleState: getComposedSignalLifecycleState(candidate),
            signal: candidate,
        }));

    return { parent, refinements };
};
