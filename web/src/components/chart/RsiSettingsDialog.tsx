"use client";

import React, { useState } from "react";
import { X, ChevronDown, Check } from "lucide-react";
import { useRsiSettings, LineStyle } from "@/hooks/useRsiSettings";

const LINE_STYLES: { id: LineStyle; label: string; icon: string }[] = [
    { id: "solid", label: "Solid", icon: "━" },
    { id: "dotted", label: "Dotted", icon: "..." },
    { id: "dashed", label: "Dashed", icon: "---" },
];

export default function RsiSettingsDialog() {
    const { settings, isDialogOpen, closeDialog, updateSettings, resetToDefaults } = useRsiSettings();
    const [activeTab, setActiveTab] = useState<"style" | "visibility">("style");

    // Local state to handle "Ok" and "Cancel" effectively, or just live update? 
    // Reference says "Ok" and "Cancel", so maybe we should buffer?
    // But usually in these apps live update is preferred. 
    // Let's implement with live update for now but with a "buffer" if we want to follow "Ok/Cancel" strictly.
    // Actually, let's keep it simple: Live update + "Reset to Defaults".

    if (!isDialogOpen) return null;

    const handleToggle = (key: keyof typeof settings, visible: boolean) => {
        const section = settings[key] as any;
        if (typeof section === 'object' && 'visible' in section) {
            updateSettings({ [key]: { ...section, visible } });
        }
    };

    const handleValueChange = (key: keyof typeof settings, value: number) => {
        const section = settings[key] as any;
        updateSettings({ [key]: { ...section, value } });
    };

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="w-[420px] rounded-xl border border-border-muted bg-[#1e222d] shadow-2xl animate-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2e39]">
                    <h2 className="text-lg font-bold text-text-primary">RSI-HVV</h2>
                    <button onClick={closeDialog} className="text-text-muted hover:text-text-primary transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex px-4 border-b border-[#2a2e39]">
                    <button
                        onClick={() => setActiveTab("style")}
                        className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${activeTab === "style" ? "border-accent text-accent" : "border-transparent text-text-muted hover:text-text-primary"
                            }`}
                    >
                        Style
                    </button>
                    <button
                        onClick={() => setActiveTab("visibility")}
                        className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${activeTab === "visibility" ? "border-accent text-accent" : "border-transparent text-text-muted hover:text-text-primary"
                            }`}
                    >
                        Visibility
                    </button>
                </div>

                {/* Content */}
                <div className="p-4 max-h-[500px] overflow-y-auto space-y-4">
                    {activeTab === "style" && (
                        <div className="space-y-4">
                            {/* RSI14 */}
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={settings.rsi14.visible}
                                        onChange={(e) => handleToggle("rsi14", e.target.checked)}
                                        className="accent-accent w-4 h-4"
                                    />
                                    <span className="text-sm font-medium text-text-primary">RSI14</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="flex gap-1">
                                        {settings.rsi14.colors.map((c, i) => (
                                            <div key={i} className="w-6 h-6 rounded border border-white/10" style={{ backgroundColor: c }} />
                                        ))}
                                    </div>
                                    <div className="p-1 px-2 border border-[#2a2e39] rounded bg-[#2a2e39] text-xs font-mono text-text-muted">
                                        {LINE_STYLES.find(s => s.id === settings.rsi14.lineStyle)?.icon}
                                    </div>
                                </div>
                            </div>

                            {/* EMA9 */}
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={settings.ema9.visible}
                                        onChange={(e) => handleToggle("ema9", e.target.checked)}
                                        className="accent-accent w-4 h-4"
                                    />
                                    <span className="text-sm font-medium text-text-primary">EMA9</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="w-6 h-6 rounded border border-white/10" style={{ backgroundColor: settings.ema9.color }} />
                                    <div className="p-1 px-2 border border-[#2a2e39] rounded bg-[#2a2e39] text-xs font-mono text-text-muted">
                                        {LINE_STYLES.find(s => s.id === settings.ema9.lineStyle)?.icon}
                                    </div>
                                </div>
                            </div>

                            {/* WMA45 */}
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={settings.wma45.visible}
                                        onChange={(e) => handleToggle("wma45", e.target.checked)}
                                        className="accent-accent w-4 h-4"
                                    />
                                    <span className="text-sm font-medium text-text-primary">WMA45</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="w-6 h-6 rounded border border-white/10" style={{ backgroundColor: settings.wma45.color }} />
                                    <div className="p-1 px-2 border border-[#2a2e39] rounded bg-[#2a2e39] text-xs font-mono text-text-muted">
                                        {LINE_STYLES.find(s => s.id === settings.wma45.lineStyle)?.icon}
                                    </div>
                                </div>
                            </div>

                            <div className="h-[1px] bg-[#2a2e39]" />

                            {/* Buy Signal */}
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={settings.buySignal.visible}
                                        onChange={(e) => handleToggle("buySignal", e.target.checked)}
                                        className="accent-accent w-4 h-4"
                                    />
                                    <span className="text-sm font-medium text-text-primary">Buy Signal</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="w-6 h-6 rounded border border-white/10" style={{ backgroundColor: settings.buySignal.color }} />
                                    <div className="p-1 border border-[#2a2e39] rounded bg-[#2a2e39] text-[10px] text-text-muted">
                                        △
                                    </div>
                                    <div className="flex items-center gap-1 px-2 py-1 border border-[#2a2e39] rounded bg-[#2a2e39] text-xs text-text-primary">
                                        Absolute <ChevronDown size={12} />
                                    </div>
                                </div>
                            </div>

                            {/* Sell Signal */}
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={settings.sellSignal.visible}
                                        onChange={(e) => handleToggle("sellSignal", e.target.checked)}
                                        className="accent-accent w-4 h-4"
                                    />
                                    <span className="text-sm font-medium text-text-primary">Sell Signal</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="w-6 h-6 rounded border border-white/10" style={{ backgroundColor: settings.sellSignal.color }} />
                                    <div className="p-1 border border-[#2a2e39] rounded bg-[#2a2e39] text-[10px] text-text-muted">
                                        ▽
                                    </div>
                                    <div className="flex items-center gap-1 px-2 py-1 border border-[#2a2e39] rounded bg-[#2a2e39] text-xs text-text-primary">
                                        Absolute <ChevronDown size={12} />
                                    </div>
                                </div>
                            </div>

                            <div className="h-[1px] bg-[#2a2e39]" />

                            {/* Overbought */}
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={settings.overbought.visible}
                                        onChange={(e) => handleToggle("overbought", e.target.checked)}
                                        className="accent-accent w-4 h-4"
                                    />
                                    <span className="text-sm font-medium text-text-primary">Overbought</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="w-6 h-6 rounded border border-white/10" style={{ backgroundColor: settings.overbought.color }} />
                                    <div className="p-1 px-2 border border-[#2a2e39] rounded bg-[#2a2e39] text-xs font-mono text-text-muted">
                                        ...
                                    </div>
                                    <input
                                        type="number"
                                        value={settings.overbought.value}
                                        onChange={(e) => handleValueChange("overbought", Number(e.target.value))}
                                        className="w-12 px-1 py-1 bg-[#2a2e39] border border-[#2a2e39] rounded text-xs text-text-primary outline-none focus:border-accent"
                                    />
                                </div>
                            </div>

                            {/* Midline */}
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={settings.midline.visible}
                                        onChange={(e) => handleToggle("midline", e.target.checked)}
                                        className="accent-accent w-4 h-4"
                                    />
                                    <span className="text-sm font-medium text-text-primary">Midline</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="w-6 h-6 rounded border border-white/10" style={{ backgroundColor: settings.midline.color }} />
                                    <div className="p-1 px-2 border border-[#2a2e39] rounded bg-[#2a2e39] text-xs font-mono text-text-muted">
                                        ---
                                    </div>
                                    <input
                                        type="number"
                                        value={settings.midline.value}
                                        onChange={(e) => handleValueChange("midline", Number(e.target.value))}
                                        className="w-12 px-1 py-1 bg-[#2a2e39] border border-[#2a2e39] rounded text-xs text-text-primary outline-none focus:border-accent"
                                    />
                                </div>
                            </div>

                            {/* Oversold */}
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={settings.oversold.visible}
                                        onChange={(e) => handleToggle("oversold", e.target.checked)}
                                        className="accent-accent w-4 h-4"
                                    />
                                    <span className="text-sm font-medium text-text-primary">Oversold</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="w-6 h-6 rounded border border-white/10" style={{ backgroundColor: settings.oversold.color }} />
                                    <div className="p-1 px-2 border border-[#2a2e39] rounded bg-[#2a2e39] text-xs font-mono text-text-muted">
                                        ...
                                    </div>
                                    <input
                                        type="number"
                                        value={settings.oversold.value}
                                        onChange={(e) => handleValueChange("oversold", Number(e.target.value))}
                                        className="w-12 px-1 py-1 bg-[#2a2e39] border border-[#2a2e39] rounded text-xs text-text-primary outline-none focus:border-accent"
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === "visibility" && (
                        <div className="text-sm text-text-muted italic">
                            Visibility settings coming soon...
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-[#2a2e39] flex items-center justify-between">
                    <div className="relative group">
                        <button className="flex items-center gap-1 text-sm text-text-muted hover:text-text-primary transition-colors">
                            Defaults <ChevronDown size={14} />
                        </button>
                        <div className="absolute bottom-full left-0 mb-2 w-32 bg-[#1e222d] border border-border-muted rounded shadow-xl hidden group-hover:block overflow-hidden z-10">
                            <button
                                onClick={resetToDefaults}
                                className="w-full px-4 py-2 text-left text-xs text-text-primary hover:bg-accent/10 hover:text-accent transition-colors"
                            >
                                Reset Settings
                            </button>
                            <button className="w-full px-4 py-2 text-left text-xs text-text-primary hover:bg-accent/10 hover:text-accent transition-colors border-t border-border-muted/50">
                                Save As Default
                            </button>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={closeDialog}
                            className="px-4 py-1.5 rounded bg-[#2a2e39] hover:bg-[#363a45] text-sm font-bold text-text-primary transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={closeDialog}
                            className="px-4 py-1.5 rounded bg-accent hover:bg-accent/90 text-sm font-bold text-white transition-colors"
                        >
                            Ok
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
