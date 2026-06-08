"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import {
    ChevronDown,
    ChevronUp,
    Filter,
    Loader2,
    Plus,
    RefreshCcw,
    Search,
    ShieldCheck,
    UserCog,
    Users,
} from "lucide-react";
import { createManagedUser, listManagedUsers, updateManagedUser } from "@/lib/authApi";
import { moduleLabels } from "@/lib/authAccess";
import { AUTH_MODULE_KEYS, AuthModuleKey, AuthRoleKey, AuthSessionUser } from "@/types/auth";

type UserDraft = {
    email: string;
    username: string;
    displayName: string;
    password: string;
    role: AuthRoleKey;
    isActive: boolean;
    modules: AuthModuleKey[];
};

type UserFilterKey = "all" | "admins" | "active" | "disabled";

const MIN_PASSWORD_LENGTH = 8;

const filterLabels: Record<UserFilterKey, string> = {
    all: "All users",
    admins: "Admins",
    active: "Active",
    disabled: "Disabled",
};

const normalizeModules = (modules: AuthModuleKey[]) => (
    AUTH_MODULE_KEYS.filter((moduleKey) => modules.includes(moduleKey))
);

const getEffectiveModules = (role: AuthRoleKey, modules: AuthModuleKey[]) => (
    role === "ADMIN" ? [...AUTH_MODULE_KEYS] : normalizeModules(modules)
);

const toDraft = (user?: AuthSessionUser): UserDraft => ({
    email: user?.email ?? "",
    username: user?.username ?? "",
    displayName: user?.displayName ?? "",
    password: "",
    role: user?.role ?? "USER",
    isActive: user?.isActive ?? true,
    modules: user?.role === "ADMIN"
        ? [...AUTH_MODULE_KEYS]
        : normalizeModules(user?.modules ?? ["chart"]),
});

const toggleModule = (modules: AuthModuleKey[], moduleKey: AuthModuleKey) => (
    normalizeModules(
        modules.includes(moduleKey)
            ? modules.filter((value) => value !== moduleKey)
            : [...modules, moduleKey],
    )
);

const collectDraftIssues = (
    draft: UserDraft,
    { requirePassword }: { requirePassword: boolean },
) => {
    const issues: string[] = [];

    if (!draft.email.trim()) {
        issues.push("Email is required.");
    }

    if (!draft.username.trim()) {
        issues.push("Username is required.");
    }

    if (requirePassword && !draft.password.trim()) {
        issues.push("Temporary password is required.");
    }

    if (draft.password.trim() && draft.password.trim().length < MIN_PASSWORD_LENGTH) {
        issues.push(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    }

    if (draft.role === "USER" && draft.modules.length === 0) {
        issues.push("User accounts need at least one module grant.");
    }

    return issues;
};

const areModulesEqual = (left: AuthModuleKey[], right: AuthModuleKey[]) => (
    left.length === right.length && left.every((value, index) => value === right[index])
);

const hasDraftChanges = (draft: UserDraft, user: AuthSessionUser) => {
    if (draft.password.trim()) {
        return true;
    }

    const currentModules = getEffectiveModules(user.role, user.modules);
    const draftModules = getEffectiveModules(draft.role, draft.modules);

    return draft.email !== user.email
        || draft.username !== user.username
        || draft.displayName !== (user.displayName ?? "")
        || draft.role !== user.role
        || draft.isActive !== user.isActive
        || !areModulesEqual(draftModules, currentModules);
};

function StatCard({
    label,
    value,
    tone = "default",
    helper,
}: {
    label: string;
    value: number;
    tone?: "default" | "accent" | "success" | "danger";
    helper: string;
}) {
    const valueClassName = {
        default: "text-text-primary",
        accent: "text-accent",
        success: "text-price-up",
        danger: "text-price-down",
    }[tone];

    return (
        <div className="rounded-[24px] border border-border-muted bg-bg-tertiary/72 px-4 py-4 shadow-[0_14px_42px_rgba(4,10,22,0.16)]">
            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-text-muted">{label}</div>
            <div className={`mt-3 text-2xl font-black ${valueClassName}`}>{value}</div>
            <div className="mt-2 text-xs leading-5 text-text-secondary">{helper}</div>
        </div>
    );
}

function FilterButton({
    label,
    count,
    active,
    onClick,
}: {
    label: string;
    count: number;
    active: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={active}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-black uppercase tracking-[0.14em] transition ${
                active
                    ? "border-accent/30 bg-accent/12 text-text-primary shadow-[0_10px_28px_rgba(77,140,255,0.14)]"
                    : "border-border-muted bg-bg-tertiary/70 text-text-secondary hover:border-accent/18 hover:text-text-primary"
            }`}
        >
            <span>{label}</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] ${
                active ? "bg-accent/18 text-accent" : "bg-bg-primary/90 text-text-muted"
            }`}>
                {count}
            </span>
        </button>
    );
}

function ModuleChecklist({
    modules,
    disabled,
    onToggle,
}: {
    modules: AuthModuleKey[];
    disabled?: boolean;
    onToggle: (moduleKey: AuthModuleKey) => void;
}) {
    return (
        <div className="grid gap-3 sm:grid-cols-2">
            {AUTH_MODULE_KEYS.map((moduleKey) => {
                const checked = modules.includes(moduleKey);
                const helperText = disabled
                    ? "Inherited from admin role."
                    : checked
                        ? "Module access is enabled after sign in."
                        : "Module access is currently disabled.";

                return (
                    <label
                        key={moduleKey}
                        className={`flex min-h-[86px] items-start gap-3 rounded-[24px] border px-4 py-3 transition ${
                            checked
                                ? "border-accent/26 bg-accent/10 text-text-primary"
                                : "border-border-muted bg-bg-primary/58 text-text-secondary"
                        } ${disabled ? "cursor-not-allowed opacity-80" : "cursor-pointer hover:border-accent/18 hover:bg-bg-primary/78"}`}
                    >
                        <div className="min-w-0 flex-1">
                            <div className="text-sm font-black">{moduleLabels[moduleKey]}</div>
                            <div className="mt-1 text-xs leading-5 text-text-muted">{helperText}</div>
                        </div>

                        <div
                            aria-hidden
                            className={`mt-1 flex h-6 w-11 shrink-0 items-center rounded-full border p-1 transition ${
                                checked
                                    ? "border-accent/30 bg-accent/18"
                                    : "border-border-muted bg-bg-secondary/90"
                            }`}
                        >
                            <span
                                className={`h-4 w-4 rounded-full transition ${
                                    checked
                                        ? "translate-x-5 bg-accent"
                                        : "translate-x-0 bg-text-muted/80"
                                }`}
                            />
                        </div>

                        <input
                            type="checkbox"
                            checked={checked}
                            disabled={disabled}
                            onChange={() => onToggle(moduleKey)}
                            className="sr-only"
                        />
                    </label>
                );
            })}
        </div>
    );
}

function UserCard({
    user,
    draft,
    isExpanded,
    isSaving,
    onToggleExpanded,
    onUpdateDraft,
    onSave,
}: {
    user: AuthSessionUser;
    draft: UserDraft;
    isExpanded: boolean;
    isSaving: boolean;
    onToggleExpanded: () => void;
    onUpdateDraft: (patch: Partial<UserDraft>) => void;
    onSave: () => void;
}) {
    const draftIssues = collectDraftIssues(draft, { requirePassword: false });
    const isDirty = hasDraftChanges(draft, user);
    const effectiveModules = getEffectiveModules(draft.role, draft.modules);

    return (
        <article className={`rounded-[28px] border border-border-muted bg-bg-primary/92 p-4 shadow-[0_18px_60px_rgba(4,10,22,0.18)] transition sm:p-5 ${
            isExpanded ? "border-accent/24" : ""
        }`}>
            <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <div className="truncate text-lg font-black text-text-primary sm:text-xl">
                                {user.displayName || user.username}
                            </div>
                            <span className={`rounded-full border px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] ${
                                draft.role === "ADMIN"
                                    ? "border-accent/30 bg-accent/10 text-accent"
                                    : "border-border-muted bg-bg-tertiary text-text-secondary"
                            }`}>
                                {draft.role}
                            </span>
                            <span className={`rounded-full border px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] ${
                                draft.isActive
                                    ? "border-price-up/30 bg-price-up/10 text-price-up"
                                    : "border-price-down/30 bg-price-down/10 text-price-down"
                            }`}>
                                {draft.isActive ? "Active" : "Disabled"}
                            </span>
                            {isDirty ? (
                                <span className="rounded-full border border-accent/22 bg-accent/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-accent">
                                    Unsaved
                                </span>
                            ) : (
                                <span className="rounded-full border border-border-muted bg-bg-tertiary/70 px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-text-muted">
                                    Synced
                                </span>
                            )}
                        </div>

                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-secondary">
                            <span className="truncate">{user.email}</span>
                            <span className="hidden h-1 w-1 rounded-full bg-text-muted/60 sm:block" />
                            <span>@{user.username}</span>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={onToggleExpanded}
                        className="inline-flex items-center justify-center gap-2 self-start rounded-full border border-border-muted bg-bg-tertiary/72 px-4 py-2 text-sm font-black text-text-primary transition hover:border-accent/20 hover:bg-bg-tertiary"
                    >
                        {isExpanded ? "Hide details" : "Edit access"}
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                </div>

                <div className="rounded-[24px] border border-border-muted bg-bg-tertiary/50 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-text-muted">
                            {isDirty ? "Draft module preview" : "Granted modules"}
                        </div>
                        <span className="rounded-full border border-border-muted bg-bg-primary/90 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-text-muted">
                            {effectiveModules.length} modules
                        </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                        {effectiveModules.map((moduleKey) => (
                            <span
                                key={`${user.id}-${moduleKey}`}
                                className="rounded-full border border-border-muted bg-bg-primary/90 px-2.5 py-1 text-xs font-bold text-text-primary"
                            >
                                {moduleLabels[moduleKey]}
                            </span>
                        ))}
                    </div>
                </div>
            </div>

            {isExpanded ? (
                <div className="mt-5 space-y-5 border-t border-border-muted/80 pt-5">
                    <div className="grid gap-4 lg:grid-cols-2">
                        <label className="block">
                            <div className="text-xs font-black uppercase tracking-[0.18em] text-text-muted">Email</div>
                            <input
                                value={draft.email}
                                onChange={(event) => onUpdateDraft({ email: event.target.value })}
                                className="mt-2 h-11 w-full rounded-2xl border border-border-muted bg-bg-tertiary px-4 text-sm text-text-primary outline-none transition focus:border-accent/30"
                            />
                        </label>
                        <label className="block">
                            <div className="text-xs font-black uppercase tracking-[0.18em] text-text-muted">Username</div>
                            <input
                                value={draft.username}
                                onChange={(event) => onUpdateDraft({ username: event.target.value })}
                                className="mt-2 h-11 w-full rounded-2xl border border-border-muted bg-bg-tertiary px-4 text-sm text-text-primary outline-none transition focus:border-accent/30"
                            />
                        </label>
                        <label className="block">
                            <div className="text-xs font-black uppercase tracking-[0.18em] text-text-muted">Display name</div>
                            <input
                                value={draft.displayName}
                                onChange={(event) => onUpdateDraft({ displayName: event.target.value })}
                                className="mt-2 h-11 w-full rounded-2xl border border-border-muted bg-bg-tertiary px-4 text-sm text-text-primary outline-none transition focus:border-accent/30"
                            />
                        </label>
                        <label className="block">
                            <div className="text-xs font-black uppercase tracking-[0.18em] text-text-muted">Reset password</div>
                            <input
                                type="password"
                                value={draft.password}
                                onChange={(event) => onUpdateDraft({ password: event.target.value })}
                                className="mt-2 h-11 w-full rounded-2xl border border-border-muted bg-bg-tertiary px-4 text-sm text-text-primary outline-none transition focus:border-accent/30"
                                placeholder="Leave blank to keep the current password"
                            />
                        </label>
                    </div>

                    <div className="grid gap-4 xl:grid-cols-[minmax(0,0.36fr)_minmax(0,0.64fr)]">
                        <div className="space-y-3 rounded-[24px] border border-border-muted bg-bg-tertiary/52 p-4">
                            <div className="text-xs font-black uppercase tracking-[0.18em] text-text-muted">Account state</div>
                            <label className="flex items-center justify-between gap-3 rounded-2xl border border-border-muted bg-bg-primary/72 px-4 py-3 text-sm">
                                <div>
                                    <div className="font-bold text-text-primary">Admin role</div>
                                    <div className="mt-1 text-xs text-text-muted">Admins inherit every module automatically.</div>
                                </div>
                                <input
                                    type="checkbox"
                                    checked={draft.role === "ADMIN"}
                                    onChange={(event) => onUpdateDraft({
                                        role: event.target.checked ? "ADMIN" : "USER",
                                        modules: event.target.checked ? [...AUTH_MODULE_KEYS] : draft.modules,
                                    })}
                                    className="h-4 w-4 accent-[#4d8cff]"
                                />
                            </label>
                            <label className="flex items-center justify-between gap-3 rounded-2xl border border-border-muted bg-bg-primary/72 px-4 py-3 text-sm">
                                <div>
                                    <div className="font-bold text-text-primary">Active user</div>
                                    <div className="mt-1 text-xs text-text-muted">Disable sign in without deleting access history.</div>
                                </div>
                                <input
                                    type="checkbox"
                                    checked={draft.isActive}
                                    onChange={(event) => onUpdateDraft({ isActive: event.target.checked })}
                                    className="h-4 w-4 accent-[#4d8cff]"
                                />
                            </label>
                        </div>

                        <div className="rounded-[24px] border border-border-muted bg-bg-tertiary/52 p-4">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                    <div className="text-xs font-black uppercase tracking-[0.18em] text-text-muted">Module grants</div>
                                    <div className="mt-1 text-xs leading-5 text-text-secondary">
                                        Keep Trading enabled when this user needs MT5 read surfaces.
                                    </div>
                                </div>
                                <span className="rounded-full border border-border-muted bg-bg-primary/90 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-text-muted">
                                    {draft.role === "ADMIN" ? "Locked by role" : "Editable"}
                                </span>
                            </div>

                            <div className="mt-4">
                                <ModuleChecklist
                                    modules={effectiveModules}
                                    disabled={draft.role === "ADMIN"}
                                    onToggle={(moduleKey) => onUpdateDraft({
                                        modules: toggleModule(draft.modules, moduleKey),
                                    })}
                                />
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-col gap-3 border-t border-border-muted/80 pt-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="text-xs leading-5 text-text-secondary">
                            {draftIssues[0] ? draftIssues[0] : isDirty ? "Ready to save this access update." : "No changes pending for this account."}
                        </div>

                        <button
                            type="button"
                            disabled={isSaving || draftIssues.length > 0 || !isDirty}
                            onClick={onSave}
                            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-accent px-4 py-2.5 text-sm font-black text-bg-secondary transition disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                        >
                            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                            Save access
                        </button>
                    </div>
                </div>
            ) : null}
        </article>
    );
}

export default function AdminUsersWorkspace() {
    const [users, setUsers] = useState<AuthSessionUser[]>([]);
    const [drafts, setDrafts] = useState<Record<string, UserDraft>>({});
    const [createDraft, setCreateDraft] = useState<UserDraft>({
        email: "",
        username: "",
        displayName: "",
        password: "",
        role: "USER",
        isActive: true,
        modules: ["chart"],
    });
    const [loading, setLoading] = useState(true);
    const [savingUserId, setSavingUserId] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [query, setQuery] = useState("");
    const [activeFilter, setActiveFilter] = useState<UserFilterKey>("all");
    const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

    const deferredQuery = useDeferredValue(query);
    const createIssues = collectDraftIssues(createDraft, { requirePassword: true });

    const syncDrafts = (rows: AuthSessionUser[]) => {
        setUsers(rows);
        setDrafts(Object.fromEntries(rows.map((user) => [user.id, toDraft(user)])));
    };

    const loadUsers = useCallback(async () => {
        setLoading(true);
        setError(null);

        try {
            syncDrafts(await listManagedUsers());
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : "Unable to load user access settings.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadUsers();
    }, [loadUsers]);

    const summary = useMemo(() => ({
        total: users.length,
        adminCount: users.filter((user) => user.role === "ADMIN").length,
        activeCount: users.filter((user) => user.isActive).length,
        disabledCount: users.filter((user) => !user.isActive).length,
    }), [users]);

    const filteredUsers = useMemo(() => {
        const normalizedQuery = deferredQuery.trim().toLowerCase();

        return users.filter((user) => {
            const matchesQuery = normalizedQuery.length === 0
                || user.email.toLowerCase().includes(normalizedQuery)
                || user.username.toLowerCase().includes(normalizedQuery)
                || (user.displayName ?? "").toLowerCase().includes(normalizedQuery);

            if (!matchesQuery) {
                return false;
            }

            if (activeFilter === "admins") {
                return user.role === "ADMIN";
            }

            if (activeFilter === "active") {
                return user.isActive;
            }

            if (activeFilter === "disabled") {
                return !user.isActive;
            }

            return true;
        });
    }, [activeFilter, deferredQuery, users]);

    const filterCounts = useMemo(() => ({
        all: users.length,
        admins: users.filter((user) => user.role === "ADMIN").length,
        active: users.filter((user) => user.isActive).length,
        disabled: users.filter((user) => !user.isActive).length,
    }), [users]);

    useEffect(() => {
        setExpandedUserId((current) => {
            if (filteredUsers.length === 0) {
                return null;
            }

            return filteredUsers.some((user) => user.id === current)
                ? current
                : filteredUsers[0].id;
        });
    }, [filteredUsers]);

    const updateDraft = (userId: string, patch: Partial<UserDraft>) => {
        setDrafts((current) => ({
            ...current,
            [userId]: {
                ...(current[userId] ?? toDraft()),
                ...patch,
            },
        }));
    };

    const handleCreateUser = async () => {
        setCreating(true);
        setError(null);

        try {
            await createManagedUser({
                email: createDraft.email,
                username: createDraft.username,
                displayName: createDraft.displayName || null,
                password: createDraft.password,
                role: createDraft.role,
                isActive: createDraft.isActive,
                modules: getEffectiveModules(createDraft.role, createDraft.modules),
            });

            setCreateDraft({
                email: "",
                username: "",
                displayName: "",
                password: "",
                role: "USER",
                isActive: true,
                modules: ["chart"],
            });

            await loadUsers();
        } catch (createError) {
            setError(createError instanceof Error ? createError.message : "Unable to create the user.");
        } finally {
            setCreating(false);
        }
    };

    const handleSaveUser = async (userId: string) => {
        const draft = drafts[userId];
        if (!draft) {
            return;
        }

        setSavingUserId(userId);
        setError(null);

        try {
            await updateManagedUser(userId, {
                email: draft.email,
                username: draft.username,
                displayName: draft.displayName || null,
                password: draft.password.trim() ? draft.password : undefined,
                role: draft.role,
                isActive: draft.isActive,
                modules: getEffectiveModules(draft.role, draft.modules),
            });

            await loadUsers();
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : "Unable to update the user.");
        } finally {
            setSavingUserId(null);
        }
    };

    return (
        <div className="command-deck-canvas h-full overflow-y-auto px-3 py-4 text-text-primary sm:px-4 sm:py-5 lg:px-6 lg:py-6">
            <div className="mx-auto flex max-w-7xl flex-col gap-4 sm:gap-6">
                <section className="rounded-[32px] border border-border-muted bg-bg-primary/94 p-5 shadow-[0_28px_90px_rgba(0,0,0,0.28)] sm:p-6">
                    <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                        <div className="max-w-3xl">
                            <div className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.24em] text-accent">
                                <UserCog className="h-3.5 w-3.5" />
                                Admin user control
                            </div>
                            <h1 className="mt-4 text-2xl font-black tracking-tight sm:text-3xl">
                                Review access quickly and edit accounts one clear step at a time.
                            </h1>
                            <p className="mt-3 max-w-2xl text-sm leading-6 text-text-secondary sm:text-[15px]">
                                This view is tuned for mobile, tablet, and desktop so account search, role checks,
                                and module assignment stay readable without forcing side scrolling or oversized forms.
                            </p>

                            <div className="mt-4 flex flex-wrap gap-2">
                                <span className="rounded-full border border-border-muted bg-bg-tertiary/70 px-3 py-1 text-xs font-bold text-text-secondary">
                                    Single-account editing
                                </span>
                                <span className="rounded-full border border-border-muted bg-bg-tertiary/70 px-3 py-1 text-xs font-bold text-text-secondary">
                                    Draft change visibility
                                </span>
                                <span className="rounded-full border border-border-muted bg-bg-tertiary/70 px-3 py-1 text-xs font-bold text-text-secondary">
                                    Search and role filters
                                </span>
                            </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2 xl:w-[30rem]">
                            <StatCard
                                label="Total users"
                                value={summary.total}
                                helper="All managed accounts visible to this admin."
                            />
                            <StatCard
                                label="Admins"
                                value={summary.adminCount}
                                tone="accent"
                                helper="Accounts with full module inheritance."
                            />
                            <StatCard
                                label="Active"
                                value={summary.activeCount}
                                tone="success"
                                helper="Accounts that can still sign in."
                            />
                            <StatCard
                                label="Disabled"
                                value={summary.disabledCount}
                                tone="danger"
                                helper="Accounts preserved without active access."
                            />
                        </div>
                    </div>

                    <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                        <div className="text-xs leading-5 text-text-secondary">
                            Changes are saved per user card, so one unfinished edit cannot overwrite another account.
                        </div>

                        <button
                            type="button"
                            onClick={() => {
                                void loadUsers();
                            }}
                            className="inline-flex items-center justify-center gap-2 rounded-full border border-border-muted bg-bg-tertiary px-4 py-2 text-sm font-black text-text-primary transition hover:border-accent/20 hover:bg-bg-tertiary/90"
                        >
                            <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                            Refresh users
                        </button>
                    </div>
                </section>

                {error ? (
                    <section className="rounded-[28px] border border-price-down/30 bg-price-down/10 p-4 text-sm text-price-down">
                        {error}
                    </section>
                ) : null}

                <section className="rounded-[28px] border border-border-muted bg-bg-primary/92 p-5 shadow-[0_20px_64px_rgba(4,10,22,0.16)] sm:p-6">
                    <div className="grid gap-5 xl:grid-cols-[minmax(0,0.32fr)_minmax(0,0.68fr)]">
                        <div className="space-y-4">
                            <div className="flex items-center gap-3">
                                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent/10 text-accent">
                                    <Plus className="h-5 w-5" />
                                </div>
                                <div>
                                    <div className="text-lg font-black">Create user</div>
                                    <div className="text-sm text-text-secondary">Start with a safe default user role, then expand access only where needed.</div>
                                </div>
                            </div>

                            <div className="rounded-[24px] border border-border-muted bg-bg-tertiary/52 p-4">
                                <div className="text-xs font-black uppercase tracking-[0.18em] text-text-muted">Creation checklist</div>
                                <div className="mt-3 space-y-2 text-sm leading-6 text-text-secondary">
                                    <div>Set email and username before saving.</div>
                                    <div>Temporary passwords must use at least {MIN_PASSWORD_LENGTH} characters.</div>
                                    <div>Standard users need at least one module enabled.</div>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-5">
                            <div className="grid gap-4 md:grid-cols-2">
                                <label className="block">
                                    <div className="text-xs font-black uppercase tracking-[0.18em] text-text-muted">Email</div>
                                    <input
                                        value={createDraft.email}
                                        onChange={(event) => setCreateDraft((current) => ({ ...current, email: event.target.value }))}
                                        className="mt-2 h-11 w-full rounded-2xl border border-border-muted bg-bg-tertiary px-4 text-sm text-text-primary outline-none transition focus:border-accent/30"
                                    />
                                </label>
                                <label className="block">
                                    <div className="text-xs font-black uppercase tracking-[0.18em] text-text-muted">Username</div>
                                    <input
                                        value={createDraft.username}
                                        onChange={(event) => setCreateDraft((current) => ({ ...current, username: event.target.value }))}
                                        className="mt-2 h-11 w-full rounded-2xl border border-border-muted bg-bg-tertiary px-4 text-sm text-text-primary outline-none transition focus:border-accent/30"
                                    />
                                </label>
                                <label className="block">
                                    <div className="text-xs font-black uppercase tracking-[0.18em] text-text-muted">Display name</div>
                                    <input
                                        value={createDraft.displayName}
                                        onChange={(event) => setCreateDraft((current) => ({ ...current, displayName: event.target.value }))}
                                        className="mt-2 h-11 w-full rounded-2xl border border-border-muted bg-bg-tertiary px-4 text-sm text-text-primary outline-none transition focus:border-accent/30"
                                    />
                                </label>
                                <label className="block">
                                    <div className="text-xs font-black uppercase tracking-[0.18em] text-text-muted">Temporary password</div>
                                    <input
                                        type="password"
                                        value={createDraft.password}
                                        onChange={(event) => setCreateDraft((current) => ({ ...current, password: event.target.value }))}
                                        className="mt-2 h-11 w-full rounded-2xl border border-border-muted bg-bg-tertiary px-4 text-sm text-text-primary outline-none transition focus:border-accent/30"
                                    />
                                </label>
                            </div>

                            <div className="grid gap-4 xl:grid-cols-[minmax(0,0.34fr)_minmax(0,0.66fr)]">
                                <div className="space-y-3 rounded-[24px] border border-border-muted bg-bg-tertiary/52 p-4">
                                    <label className="flex items-center justify-between gap-3 rounded-2xl border border-border-muted bg-bg-primary/72 px-4 py-3 text-sm">
                                        <div>
                                            <div className="font-bold text-text-primary">Admin role</div>
                                            <div className="mt-1 text-xs text-text-muted">Admins inherit every module automatically.</div>
                                        </div>
                                        <input
                                            type="checkbox"
                                            checked={createDraft.role === "ADMIN"}
                                            onChange={(event) => setCreateDraft((current) => ({
                                                ...current,
                                                role: event.target.checked ? "ADMIN" : "USER",
                                                modules: event.target.checked ? [...AUTH_MODULE_KEYS] : current.modules,
                                            }))}
                                            className="h-4 w-4 accent-[#4d8cff]"
                                        />
                                    </label>
                                    <label className="flex items-center justify-between gap-3 rounded-2xl border border-border-muted bg-bg-primary/72 px-4 py-3 text-sm">
                                        <div>
                                            <div className="font-bold text-text-primary">Active user</div>
                                            <div className="mt-1 text-xs text-text-muted">Disable this to provision the account without immediate access.</div>
                                        </div>
                                        <input
                                            type="checkbox"
                                            checked={createDraft.isActive}
                                            onChange={(event) => setCreateDraft((current) => ({ ...current, isActive: event.target.checked }))}
                                            className="h-4 w-4 accent-[#4d8cff]"
                                        />
                                    </label>
                                </div>

                                <div className="rounded-[24px] border border-border-muted bg-bg-tertiary/52 p-4">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div>
                                            <div className="text-xs font-black uppercase tracking-[0.18em] text-text-muted">Module grants</div>
                                            <div className="mt-1 text-xs leading-5 text-text-secondary">
                                                Keep Trading enabled when the user needs MT5 monitoring surfaces.
                                            </div>
                                        </div>
                                        <span className="rounded-full border border-border-muted bg-bg-primary/90 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-text-muted">
                                            {createDraft.role === "ADMIN" ? "Locked by role" : "Pick access"}
                                        </span>
                                    </div>

                                    <div className="mt-4">
                                        <ModuleChecklist
                                            modules={getEffectiveModules(createDraft.role, createDraft.modules)}
                                            disabled={createDraft.role === "ADMIN"}
                                            onToggle={(moduleKey) => setCreateDraft((current) => ({
                                                ...current,
                                                modules: toggleModule(current.modules, moduleKey),
                                            }))}
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="flex flex-col gap-3 border-t border-border-muted/80 pt-4 sm:flex-row sm:items-center sm:justify-between">
                                <div className="text-xs leading-5 text-text-secondary">
                                    {createIssues[0] ? createIssues[0] : "The account will appear below immediately after creation."}
                                </div>

                                <button
                                    type="button"
                                    disabled={creating || createIssues.length > 0}
                                    onClick={() => {
                                        void handleCreateUser();
                                    }}
                                    className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-accent px-4 py-2.5 text-sm font-black text-bg-secondary transition disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                                >
                                    {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                                    Create user
                                </button>
                            </div>
                        </div>
                    </div>
                </section>

                <section className="rounded-[28px] border border-border-muted bg-bg-primary/92 p-5 shadow-[0_20px_64px_rgba(4,10,22,0.16)] sm:p-6">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                        <div>
                            <div className="inline-flex items-center gap-2 rounded-full border border-border-muted bg-bg-tertiary/70 px-3 py-1 text-[11px] font-black uppercase tracking-[0.22em] text-text-muted">
                                <Users className="h-3.5 w-3.5" />
                                Managed accounts
                            </div>
                            <h2 className="mt-3 text-xl font-black text-text-primary sm:text-2xl">Find the right account before you edit it.</h2>
                            <p className="mt-2 max-w-2xl text-sm leading-6 text-text-secondary">
                                Search by name, username, or email, then focus on a single expandable card to avoid cramped side-by-side edits.
                            </p>
                        </div>

                        <div className="text-sm font-medium text-text-secondary">
                            Showing <span className="font-black text-text-primary">{filteredUsers.length}</span> of <span className="font-black text-text-primary">{users.length}</span> users
                        </div>
                    </div>

                    <div className="mt-5 flex flex-col gap-4 lg:flex-row lg:items-center">
                        <label className="relative block min-w-0 flex-1">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                            <input
                                value={query}
                                onChange={(event) => setQuery(event.target.value)}
                                placeholder="Search display name, username, or email"
                                className="h-11 w-full rounded-full border border-border-muted bg-bg-tertiary pl-10 pr-4 text-sm text-text-primary outline-none transition focus:border-accent/30"
                            />
                        </label>

                        <div className="flex min-w-0 items-center gap-2 overflow-x-auto pb-1">
                            <div className="inline-flex items-center gap-2 rounded-full border border-border-muted bg-bg-tertiary/70 px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-text-muted">
                                <Filter className="h-3.5 w-3.5" />
                                Filters
                            </div>
                            {(Object.keys(filterLabels) as UserFilterKey[]).map((filterKey) => (
                                <FilterButton
                                    key={filterKey}
                                    label={filterLabels[filterKey]}
                                    count={filterCounts[filterKey]}
                                    active={activeFilter === filterKey}
                                    onClick={() => setActiveFilter(filterKey)}
                                />
                            ))}
                        </div>
                    </div>

                    <div className="mt-6 grid gap-4 2xl:grid-cols-2">
                        {loading ? (
                            <div className="col-span-full rounded-[24px] border border-border-muted bg-bg-tertiary/50 p-6 text-sm text-text-secondary">
                                <div className="flex items-center gap-3 text-text-primary">
                                    <Loader2 className="h-4 w-4 animate-spin text-accent" />
                                    Loading user access list
                                </div>
                            </div>
                        ) : filteredUsers.length === 0 ? (
                            <div className="col-span-full rounded-[24px] border border-dashed border-border-muted bg-bg-tertiary/36 p-6 text-sm text-text-secondary">
                                No users match the current search or filter state.
                            </div>
                        ) : filteredUsers.map((user) => (
                            <UserCard
                                key={user.id}
                                user={user}
                                draft={drafts[user.id] ?? toDraft(user)}
                                isExpanded={expandedUserId === user.id}
                                isSaving={savingUserId === user.id}
                                onToggleExpanded={() => {
                                    setExpandedUserId((current) => current === user.id ? null : user.id);
                                }}
                                onUpdateDraft={(patch) => updateDraft(user.id, patch)}
                                onSave={() => {
                                    void handleSaveUser(user.id);
                                }}
                            />
                        ))}
                    </div>
                </section>
            </div>
        </div>
    );
}
