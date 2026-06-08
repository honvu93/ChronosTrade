"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import {
    AlertTriangle,
    BookOpen,
    Loader2,
    Plus,
    RefreshCcw,
    Save,
    Search,
    ShieldAlert,
    ShieldCheck,
    Trash2,
    Upload,
} from "lucide-react";
import {
    createIndicatorCatalogDraft,
    deleteIndicatorCatalogItem,
    listIndicatorCatalog,
    publishIndicatorCatalogItem,
    retireIndicatorCatalogItem,
    updateIndicatorCatalogDraft,
} from "@/lib/indicatorCatalogApi";
import {
    buildIndicatorCatalogPrimaryWarning,
    resolveIndicatorCatalogActions,
    summarizeIndicatorCatalog,
} from "@/lib/indicatorCatalogAdminView";
import {
    IndicatorCatalogRecord,
    IndicatorCatalogWriteInput,
} from "@/types/signals";

type CatalogEditorForm = {
    id: string;
    name: string;
    category: string;
    description: string;
    runtimeBindingKey: string;
    paramSchemaText: string;
    conditionsText: string;
};

const defaultForm = (): CatalogEditorForm => ({
    id: "",
    name: "",
    category: "momentum",
    description: "",
    runtimeBindingKey: "",
    paramSchemaText: "[]",
    conditionsText: JSON.stringify([
        {
            id: "value_above",
            name: "Value Above",
            description: "Describe what this condition means in runtime terms.",
            paramSchema: [],
        },
    ], null, 2),
});

const formFromRecord = (record: IndicatorCatalogRecord): CatalogEditorForm => ({
    id: record.id,
    name: record.name,
    category: record.category,
    description: record.description,
    runtimeBindingKey: record.runtimeBindingKey ?? "",
    paramSchemaText: JSON.stringify(record.paramSchema, null, 2),
    conditionsText: JSON.stringify(record.conditions, null, 2),
});

const parseEditorForm = (form: CatalogEditorForm): IndicatorCatalogWriteInput => ({
    id: form.id,
    name: form.name,
    category: form.category,
    description: form.description,
    runtimeBindingKey: form.runtimeBindingKey,
    paramSchema: JSON.parse(form.paramSchemaText),
    conditions: JSON.parse(form.conditionsText),
});

function StatCard({
    label,
    value,
    tone = "default",
}: {
    label: string;
    value: number;
    tone?: "default" | "accent" | "warning";
}) {
    const toneClass = {
        default: "text-text-primary",
        accent: "text-accent",
        warning: "text-price-down",
    }[tone];

    return (
        <div className="rounded-[24px] border border-border-muted bg-bg-tertiary/72 px-4 py-4 shadow-[0_14px_42px_rgba(4,10,22,0.16)]">
            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-text-muted">{label}</div>
            <div className={`mt-3 text-2xl font-black ${toneClass}`}>{value}</div>
        </div>
    );
}

const lifecycleClasses: Record<IndicatorCatalogRecord["catalogStatus"], string> = {
    DRAFT: "border-border-muted bg-bg-tertiary/70 text-text-secondary",
    PUBLISHED: "border-price-up/30 bg-price-up/10 text-price-up",
    RETIRED: "border-price-down/30 bg-price-down/10 text-price-down",
};

const bindingClasses: Record<IndicatorCatalogRecord["diagnostics"]["bindingStatus"], string> = {
    MATCHED: "border-price-up/30 bg-price-up/10 text-price-up",
    MISSING_BINDING: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    MISSING_RUNTIME: "border-price-down/30 bg-price-down/10 text-price-down",
    SCHEMA_MISMATCH: "border-price-down/30 bg-price-down/10 text-price-down",
};

export default function AdminIndicatorCatalogWorkspace() {
    const [items, setItems] = useState<IndicatorCatalogRecord[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [form, setForm] = useState<CatalogEditorForm>(defaultForm());
    const [query, setQuery] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [info, setInfo] = useState<string | null>(null);

    const deferredQuery = useDeferredValue(query);
    const selectedItem = items.find((item) => item.id === selectedId) ?? null;
    const summary = useMemo(() => summarizeIndicatorCatalog(items), [items]);

    const loadCatalog = useCallback(async (preferredId?: string | null) => {
        setLoading(true);
        setError(null);

        try {
            const rows = await listIndicatorCatalog();
            setItems(rows);

            if (preferredId === null) {
                setSelectedId(null);
                setForm(defaultForm());
                return;
            }

            const nextSelectedId = preferredId
                ?? (rows.some((row) => row.id === selectedId) ? selectedId : rows[0]?.id ?? null);
            setSelectedId(nextSelectedId);
            if (!nextSelectedId) {
                setForm(defaultForm());
                return;
            }

            const nextSelectedItem = rows.find((row) => row.id === nextSelectedId);
            if (nextSelectedItem) {
                setForm(formFromRecord(nextSelectedItem));
            }
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : "Unable to load the indicator catalog.");
        } finally {
            setLoading(false);
        }
    }, [selectedId]);

    useEffect(() => {
        void loadCatalog();
    }, [loadCatalog]);

    const filteredItems = useMemo(() => {
        const normalizedQuery = deferredQuery.trim().toLowerCase();
        if (!normalizedQuery) {
            return items;
        }

        return items.filter((item) => (
            item.id.toLowerCase().includes(normalizedQuery)
            || item.name.toLowerCase().includes(normalizedQuery)
            || item.category.toLowerCase().includes(normalizedQuery)
            || item.runtimeBindingKey?.toLowerCase().includes(normalizedQuery)
        ));
    }, [deferredQuery, items]);

    const openCreateDraft = () => {
        setSelectedId(null);
        setForm(defaultForm());
        setError(null);
        setInfo("Creating a new draft. The item stays hidden from Signal Composer until publish succeeds.");
    };

    const openRecord = (item: IndicatorCatalogRecord) => {
        setSelectedId(item.id);
        setForm(formFromRecord(item));
        setError(null);
        setInfo(null);
    };

    const handleSave = async () => {
        setSaving(true);
        setError(null);
        setInfo(null);

        try {
            const payload = parseEditorForm(form);
            if (selectedItem) {
                const updated = await updateIndicatorCatalogDraft(selectedItem.id, {
                    name: payload.name,
                    category: payload.category,
                    description: payload.description,
                    runtimeBindingKey: payload.runtimeBindingKey,
                    paramSchema: payload.paramSchema,
                    conditions: payload.conditions,
                });
                await loadCatalog(updated.id);
                if (updated.catalogStatus === "PUBLISHED" && updated.hasDraftChanges) {
                    setInfo(`Saved unpublished draft changes for ${updated.id}. Signal Composer still uses the last published version until you publish.`);
                } else if (updated.catalogStatus === "PUBLISHED") {
                    setInfo(`No unpublished draft changes remain for ${updated.id}.`);
                } else {
                    setInfo(`Saved ${updated.id} as draft. Publish is required before composer can use it.`);
                }
            } else {
                const created = await createIndicatorCatalogDraft(payload);
                await loadCatalog(created.id);
                setInfo(`Created draft ${created.id}.`);
            }
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : "Unable to save the indicator draft.");
        } finally {
            setSaving(false);
        }
    };

    const handlePublish = async () => {
        if (!selectedItem) {
            return;
        }

        setSaving(true);
        setError(null);
        setInfo(null);

        try {
            const published = await publishIndicatorCatalogItem(selectedItem.id);
            await loadCatalog(published.id);
            setInfo(`Published ${published.id}. Signal Composer now reads this row from persistent catalog state.`);
        } catch (publishError) {
            setError(publishError instanceof Error ? publishError.message : "Unable to publish the indicator.");
        } finally {
            setSaving(false);
        }
    };

    const handleRetire = async () => {
        if (!selectedItem) {
            return;
        }

        const confirmed = typeof window === "undefined"
            ? true
            : window.confirm(`Retire ${selectedItem.id}? Existing signal definitions stay inspectable, but the composer will stop surfacing it.`);
        if (!confirmed) {
            return;
        }

        setSaving(true);
        setError(null);
        setInfo(null);

        try {
            const retired = await retireIndicatorCatalogItem(selectedItem.id);
            await loadCatalog(retired.id);
            setInfo(`Retired ${retired.id}.`);
        } catch (retireError) {
            setError(retireError instanceof Error ? retireError.message : "Unable to retire the indicator.");
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!selectedItem) {
            return;
        }

        const confirmed = typeof window === "undefined"
            ? true
            : window.confirm(`Delete ${selectedItem.id}? This is only safe for unused drafts that were never published.`);
        if (!confirmed) {
            return;
        }

        setSaving(true);
        setError(null);
        setInfo(null);

        try {
            await deleteIndicatorCatalogItem(selectedItem.id);
            await loadCatalog(items.find((item) => item.id !== selectedItem.id)?.id ?? null);
            setInfo(`Deleted ${selectedItem.id}.`);
        } catch (deleteError) {
            setError(deleteError instanceof Error ? deleteError.message : "Unable to delete the indicator.");
        } finally {
            setSaving(false);
        }
    };

    const actions = selectedItem ? resolveIndicatorCatalogActions(selectedItem) : null;
    const primaryWarning = selectedItem ? buildIndicatorCatalogPrimaryWarning(selectedItem) : null;
    const publishLabel = selectedItem?.hasDraftChanges && selectedItem.catalogStatus === "PUBLISHED"
        ? "Publish changes"
        : "Publish";
    const detailTimestamp = selectedItem?.hasDraftChanges ? selectedItem.draftUpdatedAt ?? selectedItem.updatedAt : selectedItem?.updatedAt ?? null;
    const detailActor = selectedItem?.hasDraftChanges
        ? selectedItem.draftUpdatedBy ?? selectedItem.updatedBy ?? selectedItem.createdBy ?? "unknown actor"
        : selectedItem?.updatedBy ?? selectedItem?.createdBy ?? "unknown actor";
    const detailLabel = selectedItem?.hasDraftChanges ? "Draft updated" : "Updated";

    return (
        <div className="command-deck-canvas h-full overflow-y-auto px-3 py-4 text-text-primary sm:px-4 sm:py-5 lg:px-6 lg:py-6">
            <div className="mx-auto flex max-w-7xl flex-col gap-4 sm:gap-6">
                <section className="rounded-[32px] border border-border-muted bg-bg-primary/94 p-5 shadow-[0_28px_90px_rgba(0,0,0,0.28)] sm:p-6">
                    <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                        <div className="max-w-3xl">
                            <div className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.24em] text-accent">
                                <BookOpen className="h-3.5 w-3.5" />
                                Indicator catalog governance
                            </div>
                            <h1 className="mt-4 text-2xl font-black tracking-tight sm:text-3xl">
                                Indicator Catalog
                            </h1>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2 xl:w-[32rem]">
                            <StatCard label="Total items" value={summary.total} />
                            <StatCard label="Published" value={summary.published} tone="accent" />
                            <StatCard label="Drafts" value={summary.drafts} />
                            <StatCard label="Broken bindings" value={summary.brokenBindings} tone="warning" />
                        </div>
                    </div>

                    <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                        <div className="relative min-w-[18rem] flex-1 sm:max-w-md">
                            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                            <input
                                value={query}
                                onChange={(event) => setQuery(event.target.value)}
                                placeholder="Search id, name, category, runtime binding"
                                className="h-11 w-full rounded-full border border-border-muted bg-bg-tertiary/78 pl-11 pr-4 text-sm text-text-primary outline-none transition focus:border-accent/30"
                            />
                        </div>

                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={openCreateDraft}
                                className="inline-flex items-center gap-2 rounded-full border border-border-muted bg-bg-tertiary px-4 py-2 text-sm font-black text-text-primary transition hover:border-accent/18"
                            >
                                <Plus className="h-4 w-4" />
                                New draft
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    void loadCatalog(selectedId);
                                }}
                                className="inline-flex items-center gap-2 rounded-full border border-border-muted bg-bg-tertiary px-4 py-2 text-sm font-black text-text-primary transition hover:border-accent/18"
                            >
                                <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                                Refresh
                            </button>
                        </div>
                    </div>
                </section>

                {error ? (
                    <section className="rounded-[28px] border border-price-down/30 bg-price-down/10 p-4 text-sm text-price-down">{error}</section>
                ) : null}
                {info ? (
                    <section className="rounded-[28px] border border-accent/20 bg-accent/10 p-4 text-sm text-text-primary">{info}</section>
                ) : null}

                <section className="grid gap-5 xl:grid-cols-[minmax(18rem,0.35fr)_minmax(0,0.65fr)]">
                    <div className="rounded-[28px] border border-border-muted bg-bg-primary/92 p-4 shadow-[0_20px_64px_rgba(4,10,22,0.16)] sm:p-5">
                        <div className="text-xs font-black uppercase tracking-[0.18em] text-text-muted">Catalog items</div>
                        <div className="mt-4 space-y-3">
                            {loading ? (
                                <div className="flex items-center justify-center py-16 text-text-muted">
                                    <Loader2 className="h-5 w-5 animate-spin" />
                                </div>
                            ) : filteredItems.length === 0 ? (
                                <div className="rounded-[22px] border border-dashed border-border-muted px-4 py-6 text-sm text-text-secondary">
                                    No indicator catalog items match the current filter.
                                </div>
                            ) : filteredItems.map((item) => (
                                <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => openRecord(item)}
                                    className={`w-full rounded-[24px] border px-4 py-4 text-left transition ${
                                        selectedId === item.id
                                            ? "border-accent/28 bg-accent/10"
                                            : "border-border-muted bg-bg-tertiary/60 hover:border-accent/18"
                                    }`}
                                >
                                    <div className="flex flex-wrap items-center gap-2">
                                        <div className="text-sm font-black text-text-primary">{item.name}</div>
                                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.16em] ${lifecycleClasses[item.catalogStatus]}`}>
                                            {item.catalogStatus}
                                        </span>
                                        {item.hasDraftChanges ? (
                                            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.16em] text-amber-300">
                                                Draft changes
                                            </span>
                                        ) : null}
                                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.16em] ${bindingClasses[item.diagnostics.bindingStatus]}`}>
                                            {item.diagnostics.bindingStatus}
                                        </span>
                                    </div>
                                    <div className="mt-2 text-xs font-mono text-text-muted">{item.id}</div>
                                    <div className="mt-1 text-xs text-text-secondary">Binding {item.runtimeBindingKey ?? "missing"} • {item.dependencies.totalSignals} dependent signals</div>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="rounded-[28px] border border-border-muted bg-bg-primary/92 p-5 shadow-[0_20px_64px_rgba(4,10,22,0.16)] sm:p-6">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                            <div>
                                <div className="text-xs font-black uppercase tracking-[0.18em] text-text-muted">
                                    {selectedItem ? "Edit catalog item" : "Create catalog draft"}
                                </div>
                                <div className="mt-2 text-xl font-black text-text-primary">
                                    {selectedItem ? `${selectedItem.name} (${selectedItem.id})` : "New indicator draft"}
                                </div>
                            </div>

                            <div className="flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    onClick={handleSave}
                                    disabled={saving}
                                    className="inline-flex items-center gap-2 rounded-full border border-accent/28 bg-accent/12 px-4 py-2 text-sm font-black text-text-primary transition hover:bg-accent/18 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                    Save draft
                                </button>
                                {selectedItem ? (
                                    <>
                                        <button
                                            type="button"
                                            onClick={handlePublish}
                                            disabled={!actions?.canPublish || saving}
                                            className="inline-flex items-center gap-2 rounded-full border border-price-up/26 bg-price-up/10 px-4 py-2 text-sm font-black text-price-up transition hover:bg-price-up/16 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            <Upload className="h-4 w-4" />
                                            {publishLabel}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleRetire}
                                            disabled={!actions?.canRetire || saving}
                                            className="inline-flex items-center gap-2 rounded-full border border-amber-500/26 bg-amber-500/10 px-4 py-2 text-sm font-black text-amber-300 transition hover:bg-amber-500/16 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            <ShieldAlert className="h-4 w-4" />
                                            Retire
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleDelete}
                                            disabled={!actions?.canDelete || saving}
                                            className="inline-flex items-center gap-2 rounded-full border border-price-down/26 bg-price-down/10 px-4 py-2 text-sm font-black text-price-down transition hover:bg-price-down/16 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                            Delete
                                        </button>
                                    </>
                                ) : null}
                            </div>
                        </div>

                        {selectedItem ? (
                            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                                <div className="rounded-[22px] border border-border-muted bg-bg-tertiary/58 p-4">
                                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-text-muted">Binding</div>
                                    <div className="mt-2 text-sm font-bold text-text-primary">{selectedItem.runtimeBindingKey ?? "Missing"}</div>
                                    <div className="mt-2 text-xs text-text-secondary">{selectedItem.diagnostics.bindingMessage}</div>
                                </div>
                                <div className="rounded-[22px] border border-border-muted bg-bg-tertiary/58 p-4">
                                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-text-muted">Dependencies</div>
                                    <div className="mt-2 text-sm font-bold text-text-primary">{selectedItem.dependencies.totalSignals} signal(s)</div>
                                    <div className="mt-2 text-xs text-text-secondary">{selectedItem.dependencies.activeSignals} active / {selectedItem.dependencies.inactiveSignals} inactive</div>
                                </div>
                                <div className="rounded-[22px] border border-border-muted bg-bg-tertiary/58 p-4">
                                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-text-muted">{detailLabel}</div>
                                    <div className="mt-2 text-sm font-bold text-text-primary">{detailTimestamp ? new Date(detailTimestamp).toLocaleString() : "Not recorded"}</div>
                                    <div className="mt-2 text-xs text-text-secondary">By {detailActor}</div>
                                </div>
                                <div className="rounded-[22px] border border-border-muted bg-bg-tertiary/58 p-4">
                                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-text-muted">Composer</div>
                                    <div className="mt-2 flex items-center gap-2 text-sm font-bold text-text-primary">
                                        {selectedItem.diagnostics.composerAvailable ? <ShieldCheck className="h-4 w-4 text-price-up" /> : <AlertTriangle className="h-4 w-4 text-price-down" />}
                                        {selectedItem.diagnostics.composerAvailable ? "Visible" : "Blocked"}
                                    </div>
                                    <div className="mt-2 text-xs text-text-secondary">Published + matched = visible in Composer</div>
                                </div>
                            </div>
                        ) : null}

                        {primaryWarning ? (
                            <div className="mt-5 rounded-[22px] border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                                {primaryWarning}
                            </div>
                        ) : null}

                        {selectedItem?.hasDraftChanges && selectedItem.catalogStatus === "PUBLISHED" ? (
                            <div className="mt-4 rounded-[22px] border border-accent/20 bg-accent/10 px-4 py-3 text-sm text-text-primary">
                                Unpublished draft changes — Composer still uses the last published version.
                            </div>
                        ) : null}

                        <div className="mt-5 grid gap-4 lg:grid-cols-2">
                            <label className="block">
                                <div className="text-xs font-black uppercase tracking-[0.18em] text-text-muted">Catalog id</div>
                                <input value={form.id} onChange={(event) => setForm((current) => ({ ...current, id: event.target.value }))} disabled={Boolean(selectedItem)} className="mt-2 h-11 w-full rounded-2xl border border-border-muted bg-bg-tertiary px-4 text-sm text-text-primary outline-none transition focus:border-accent/30 disabled:cursor-not-allowed disabled:opacity-70" />
                            </label>
                            <label className="block">
                                <div className="text-xs font-black uppercase tracking-[0.18em] text-text-muted">Runtime binding key</div>
                                <input value={form.runtimeBindingKey} onChange={(event) => setForm((current) => ({ ...current, runtimeBindingKey: event.target.value }))} className="mt-2 h-11 w-full rounded-2xl border border-border-muted bg-bg-tertiary px-4 text-sm text-text-primary outline-none transition focus:border-accent/30" />
                            </label>
                            <label className="block">
                                <div className="text-xs font-black uppercase tracking-[0.18em] text-text-muted">Name</div>
                                <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} className="mt-2 h-11 w-full rounded-2xl border border-border-muted bg-bg-tertiary px-4 text-sm text-text-primary outline-none transition focus:border-accent/30" />
                            </label>
                            <label className="block">
                                <div className="text-xs font-black uppercase tracking-[0.18em] text-text-muted">Category</div>
                                <input value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} className="mt-2 h-11 w-full rounded-2xl border border-border-muted bg-bg-tertiary px-4 text-sm text-text-primary outline-none transition focus:border-accent/30" />
                            </label>
                        </div>

                        <label className="mt-4 block">
                            <div className="text-xs font-black uppercase tracking-[0.18em] text-text-muted">Description</div>
                            <textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} rows={4} className="mt-2 w-full rounded-[24px] border border-border-muted bg-bg-tertiary px-4 py-3 text-sm text-text-primary outline-none transition focus:border-accent/30" />
                        </label>

                        <div className="mt-4 grid gap-4 xl:grid-cols-2">
                            <label className="block">
                                <div className="text-xs font-black uppercase tracking-[0.18em] text-text-muted">Param schema JSON</div>
                                <textarea value={form.paramSchemaText} onChange={(event) => setForm((current) => ({ ...current, paramSchemaText: event.target.value }))} rows={16} spellCheck={false} className="mt-2 w-full rounded-[24px] border border-border-muted bg-bg-tertiary px-4 py-3 font-mono text-xs text-text-primary outline-none transition focus:border-accent/30" />
                            </label>
                            <label className="block">
                                <div className="text-xs font-black uppercase tracking-[0.18em] text-text-muted">Conditions JSON</div>
                                <textarea value={form.conditionsText} onChange={(event) => setForm((current) => ({ ...current, conditionsText: event.target.value }))} rows={16} spellCheck={false} className="mt-2 w-full rounded-[24px] border border-border-muted bg-bg-tertiary px-4 py-3 font-mono text-xs text-text-primary outline-none transition focus:border-accent/30" />
                            </label>
                        </div>

                        {selectedItem ? (
                            <div className="mt-5 grid gap-4 xl:grid-cols-2">
                                <div className="rounded-[24px] border border-border-muted bg-bg-tertiary/52 p-4">
                                    <div className="text-xs font-black uppercase tracking-[0.18em] text-text-muted">Publish blockers</div>
                                    <div className="mt-3 space-y-2 text-sm text-text-secondary">
                                        {selectedItem.diagnostics.publishBlockingReasons.length > 0
                                            ? selectedItem.diagnostics.publishBlockingReasons.map((reason) => (
                                                <div key={reason}>{reason}</div>
                                            ))
                                            : <div>No publish blockers. Runtime binding and schema are aligned.</div>}
                                    </div>
                                </div>
                                <div className="rounded-[24px] border border-border-muted bg-bg-tertiary/52 p-4">
                                    <div className="text-xs font-black uppercase tracking-[0.18em] text-text-muted">Delete blockers</div>
                                    <div className="mt-3 space-y-2 text-sm text-text-secondary">
                                        {selectedItem.diagnostics.deleteBlockingReasons.length > 0
                                            ? selectedItem.diagnostics.deleteBlockingReasons.map((reason) => (
                                                <div key={reason}>{reason}</div>
                                            ))
                                            : <div>This draft is unused and has never been published, so hard delete is currently safe.</div>}
                                    </div>
                                </div>
                            </div>
                        ) : null}

                        {selectedItem?.dependencies.references.length ? (
                            <div className="mt-5 rounded-[24px] border border-border-muted bg-bg-tertiary/52 p-4">
                                <div className="text-xs font-black uppercase tracking-[0.18em] text-text-muted">Dependent composed signals</div>
                                <div className="mt-3 space-y-2">
                                    {selectedItem.dependencies.references.map((reference) => (
                                        <div key={reference.signalDefinitionId} className="rounded-2xl border border-border-muted bg-bg-primary/70 px-4 py-3 text-sm text-text-secondary">
                                            <div className="font-bold text-text-primary">{reference.signalName}</div>
                                            <div className="mt-1 text-xs font-mono">{reference.signalCode} v{reference.signalVersion}</div>
                                            <div className="mt-1 text-xs">{reference.blockCount} block(s) use this indicator • {reference.isActive ? "Active definition" : "Retired definition"}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : null}
                    </div>
                </section>
            </div>
        </div>
    );
}
