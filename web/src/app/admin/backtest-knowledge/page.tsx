import AccessGate from "@/components/auth/AccessGate";
import BacktestKnowledgeBase from "@/components/admin/BacktestKnowledgeBase";

export default function BacktestKnowledgePage() {
    return (
        <AccessGate requireAdmin>
            <BacktestKnowledgeBase />
        </AccessGate>
    );
}
