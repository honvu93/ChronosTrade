import {
    IndicatorCatalogDependencySummary,
    IndicatorCatalogRecord,
    IndicatorCatalogWriteInput,
} from "@/types/signals";

const buildJsonRequest = (init: RequestInit = {}): RequestInit => ({
    cache: "no-store",
    credentials: "include",
    ...init,
    headers: {
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
    },
});

const readJson = async <T,>(response: Response) => response.json().catch(() => null) as Promise<T | null>;

type IndicatorCatalogErrorResponse = {
    error: string;
    code?: string;
    reasons?: string[];
};

const unwrapResponse = async <T,>(response: Response, fallbackMessage: string) => {
    const payload = await readJson<T | IndicatorCatalogErrorResponse>(response);
    if (!response.ok || !payload) {
        const errorPayload = payload as IndicatorCatalogErrorResponse | null;
        const detail = errorPayload?.reasons?.length
            ? ` ${errorPayload.reasons.join(" ")}`
            : "";
        throw new Error(`${errorPayload?.error ?? fallbackMessage}${detail}`.trim());
    }

    return payload as T;
};

export const listIndicatorCatalog = async () => (
    unwrapResponse<IndicatorCatalogRecord[]>(
        await fetch("/api/admin/indicator-catalog", {
            cache: "no-store",
            credentials: "include",
        }),
        "Unable to load the indicator catalog.",
    )
);

export const getIndicatorCatalogDetail = async (id: string) => (
    unwrapResponse<IndicatorCatalogRecord>(
        await fetch(`/api/admin/indicator-catalog/${encodeURIComponent(id)}`, {
            cache: "no-store",
            credentials: "include",
        }),
        "Unable to load the indicator catalog item.",
    )
);

export const getIndicatorCatalogDependencies = async (id: string) => (
    unwrapResponse<IndicatorCatalogDependencySummary>(
        await fetch(`/api/admin/indicator-catalog/${encodeURIComponent(id)}/dependencies`, {
            cache: "no-store",
            credentials: "include",
        }),
        "Unable to load indicator dependencies.",
    )
);

export const createIndicatorCatalogDraft = async (input: IndicatorCatalogWriteInput) => (
    unwrapResponse<IndicatorCatalogRecord>(
        await fetch("/api/admin/indicator-catalog", buildJsonRequest({
            method: "POST",
            body: JSON.stringify(input),
        })),
        "Unable to create the indicator draft.",
    )
);

export const updateIndicatorCatalogDraft = async (id: string, input: Omit<IndicatorCatalogWriteInput, "id">) => (
    unwrapResponse<IndicatorCatalogRecord>(
        await fetch(`/api/admin/indicator-catalog/${encodeURIComponent(id)}`, buildJsonRequest({
            method: "PATCH",
            body: JSON.stringify(input),
        })),
        "Unable to update the indicator draft.",
    )
);

export const publishIndicatorCatalogItem = async (id: string) => (
    unwrapResponse<IndicatorCatalogRecord>(
        await fetch(`/api/admin/indicator-catalog/${encodeURIComponent(id)}/publish`, buildJsonRequest({
            method: "POST",
            body: JSON.stringify({}),
        })),
        "Unable to publish the indicator.",
    )
);

export const retireIndicatorCatalogItem = async (id: string) => (
    unwrapResponse<IndicatorCatalogRecord>(
        await fetch(`/api/admin/indicator-catalog/${encodeURIComponent(id)}/retire`, buildJsonRequest({
            method: "POST",
            body: JSON.stringify({}),
        })),
        "Unable to retire the indicator.",
    )
);

export const deleteIndicatorCatalogItem = async (id: string) => (
    unwrapResponse<{ id: string; deletedBy: string }>(
        await fetch(`/api/admin/indicator-catalog/${encodeURIComponent(id)}`, {
            method: "DELETE",
            cache: "no-store",
            credentials: "include",
        }),
        "Unable to delete the indicator draft.",
    )
);
