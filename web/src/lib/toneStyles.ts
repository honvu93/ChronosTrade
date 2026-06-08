export type Tone = "danger" | "success" | "accent" | "neutral";

export const toneStyles: Record<Tone, string> = {
    danger: "border-price-down/20 bg-price-down/8 text-price-down",
    success: "border-price-up/20 bg-price-up/8 text-price-up",
    accent: "border-accent/20 bg-accent/8 text-accent",
    neutral: "border-border-muted bg-bg-tertiary text-text-secondary",
};

export const factTextToneStyles: Record<Tone, string> = {
    danger: "text-price-down",
    success: "text-price-up",
    accent: "text-accent",
    neutral: "text-text-primary",
};
