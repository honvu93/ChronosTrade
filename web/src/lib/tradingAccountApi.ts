import { buildTradingAuthHeaders, readTradingAuthToken } from "@/lib/tradingApiAuth";
import {
    TradingAccountDeleteEnvelope,
    TradingAccountListEnvelope,
    TradingAccountMutationEnvelope,
    TradingAccountMutationInput,
    TradingAccountSelectionEnvelope,
    TradingAccountSummary,
    TradingErrorEnvelope,
} from "@/types/trading";

const ENDPOINT = "/api/trading/accounts";

function buildScopedEndpoint(
    path = "",
    options: { ownerUserId?: string | null } = {},
) {
    const searchParams = new URLSearchParams();
    if (options.ownerUserId) {
        searchParams.set("userId", options.ownerUserId);
    }

    const endpoint = `${ENDPOINT}${path}`;
    return searchParams.size > 0 ? `${endpoint}?${searchParams.toString()}` : endpoint;
}

async function parseTradingResponse<TSuccess>(
    response: Response,
): Promise<TSuccess> {
    const payload = await response.json().catch(() => null) as TSuccess | TradingErrorEnvelope | null;
    if (!response.ok || !payload || (payload as TradingErrorEnvelope).success === false) {
        throw new Error(
            payload && (payload as TradingErrorEnvelope).success === false
                ? (payload as TradingErrorEnvelope).error.message
                : "MT5 account request failed.",
        );
    }

    return payload as TSuccess;
}

function requireTradingAuthToken() {
    const authToken = readTradingAuthToken();
    if (!authToken) {
        throw new Error("A signed-in session is required before MT5 account management can continue.");
    }

    return authToken;
}

export async function listTradingAccounts(
    options: { ownerUserId?: string | null } = {},
): Promise<{
    accounts: TradingAccountSummary[];
    activeAccountId: string | null;
}> {
    const response = await fetch(buildScopedEndpoint("", options), {
        cache: "no-store",
        headers: buildTradingAuthHeaders(requireTradingAuthToken()),
    });
    const payload = await parseTradingResponse<TradingAccountListEnvelope>(response);
    return payload.data;
}

export async function createTradingAccount(
    input: TradingAccountMutationInput,
): Promise<TradingAccountSummary> {
    const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...buildTradingAuthHeaders(requireTradingAuthToken()),
        },
        body: JSON.stringify(input),
    });
    const payload = await parseTradingResponse<TradingAccountMutationEnvelope>(response);
    return payload.data.account;
}

export async function updateTradingAccount(
    accountId: string,
    input: TradingAccountMutationInput,
    options: { ownerUserId?: string | null } = {},
): Promise<TradingAccountSummary> {
    const response = await fetch(buildScopedEndpoint(`/${accountId}`, options), {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
            ...buildTradingAuthHeaders(requireTradingAuthToken()),
        },
        body: JSON.stringify(input),
    });
    const payload = await parseTradingResponse<TradingAccountMutationEnvelope>(response);
    return payload.data.account;
}

export async function deleteTradingAccount(
    accountId: string,
    options: { ownerUserId?: string | null } = {},
): Promise<{
    deletedId: string;
    activeAccountId: string | null;
}> {
    const response = await fetch(buildScopedEndpoint(`/${accountId}`, options), {
        method: "DELETE",
        headers: buildTradingAuthHeaders(requireTradingAuthToken()),
    });
    const payload = await parseTradingResponse<TradingAccountDeleteEnvelope>(response);
    return payload.data;
}

export async function selectTradingAccount(
    accountId: string,
    options: { ownerUserId?: string | null } = {},
): Promise<{
    account: TradingAccountSummary;
    activeAccountId: string;
}> {
    const response = await fetch(buildScopedEndpoint(`/${accountId}/select`, options), {
        method: "POST",
        headers: buildTradingAuthHeaders(requireTradingAuthToken()),
    });
    const payload = await parseTradingResponse<TradingAccountSelectionEnvelope>(response);
    return payload.data;
}
