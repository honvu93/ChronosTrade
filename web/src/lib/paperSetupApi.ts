"use client";

export interface PaperSetupResponse {
    instanceId: string;
    bindingId: string;
    accountId: string;
    signalCode: string;
    signalVersion: number;
    signalName: string;
}

async function parseTradingResponse<T>(response: Response): Promise<T> {
    const payload = await response.json().catch(() => null) as { success: boolean; data?: T; error?: { message: string } } | null;
    if (!response.ok || !payload || !payload.success) {
        throw new Error(payload?.error?.message ?? "Paper setup request failed.");
    }
    return payload.data as T;
}

export async function paperSetup(
    accountId: string,
    input: {
        signalCode: string;
        signalVersion: number;
        riskPercent: number;
        symbol: string;
        timeframe: string;
    },
): Promise<PaperSetupResponse> {
    const response = await fetch(`/api/trading/accounts/${accountId}/paper-setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(input),
    });
    return parseTradingResponse<PaperSetupResponse>(response);
}

export async function activatePaperBinding(accountId: string, bindingId: string): Promise<void> {
    const response = await fetch(`/api/trading/accounts/${accountId}/automation/bindings/${bindingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: "ACTIVE" }),
    });
    await parseTradingResponse(response);
}
