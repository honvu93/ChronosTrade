import AccessGate from "@/components/auth/AccessGate";
import AdminMonitoringWorkspace from "@/components/admin/AdminMonitoringWorkspace";
import AdminSectionTabs from "@/components/admin/AdminSectionTabs";

export default function AdminMonitoringPage() {
    return (
        <AccessGate requireAdmin>
            <>
                <AdminSectionTabs />
                <AdminMonitoringWorkspace />
            </>
        </AccessGate>
    );
}
