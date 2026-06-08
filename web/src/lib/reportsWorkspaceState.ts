import type { EngineRun } from "@/types/engine";

export const resolveReportsWorkspaceCatalogRun = ({
    runs,
    requestedRunId,
    selectedRunId,
}: {
    runs: EngineRun[];
    requestedRunId: string;
    selectedRunId: string;
}) => {
    if (requestedRunId) {
        return runs.find((run) => run.id === requestedRunId) ?? null;
    }

    if (selectedRunId) {
        return runs.find((run) => run.id === selectedRunId) ?? null;
    }

    return runs[0] ?? null;
};

export const resolveReportsWorkspaceActiveRunId = ({
    runs,
    requestedRunId,
    selectedRunId,
}: {
    runs: EngineRun[];
    requestedRunId: string;
    selectedRunId: string;
}) => {
    if (requestedRunId) {
        return requestedRunId;
    }

    if (selectedRunId) {
        return selectedRunId;
    }

    return runs[0]?.id ?? "";
};

export const buildReportsWorkspaceViewState = ({
    catalogError,
    isCatalogLoading,
    activeRunId,
}: {
    catalogError: string | null;
    isCatalogLoading: boolean;
    activeRunId: string;
}) => ({
    showCatalogErrorBanner: Boolean(catalogError),
    showReportSelectionEmpty: !isCatalogLoading && !catalogError && !activeRunId,
});
