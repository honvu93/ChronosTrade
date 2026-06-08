import { ComposedSignal } from "@/types/signals";

export type ComposedSignalLifecycleState = "ACTIVE" | "RETIRED";
export type ComposedSignalLifecycleFilter = "ALL" | ComposedSignalLifecycleState;

export const getComposedSignalLifecycleState = (
    signal: Pick<ComposedSignal, "isActive">,
): ComposedSignalLifecycleState => (signal.isActive ? "ACTIVE" : "RETIRED");

export const summarizeComposedSignalLifecycles = (signals: ComposedSignal[]) => {
    const active = signals.filter((signal) => signal.isActive).length;

    return {
        all: signals.length,
        active,
        retired: signals.length - active,
    };
};

export const filterComposedSignalsByLifecycle = (
    signals: ComposedSignal[],
    filter: ComposedSignalLifecycleFilter,
) => {
    if (filter === "ALL") {
        return signals;
    }

    return signals.filter((signal) => getComposedSignalLifecycleState(signal) === filter);
};

export const getComposedSignalLifecycleMessage = (
    state: ComposedSignalLifecycleState,
) => {
    if (state === "ACTIVE") {
        return "Active definitions remain available for reopening, updates, and validation-ready generation.";
    }

    return "Retired definitions remain inspectable for traceability and are not validation-ready.";
};
