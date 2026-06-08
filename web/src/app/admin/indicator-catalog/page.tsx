import AccessGate from "@/components/auth/AccessGate";
import AdminIndicatorCatalogWorkspace from "@/components/admin/AdminIndicatorCatalogWorkspace";
import AdminSectionTabs from "@/components/admin/AdminSectionTabs";

export default function AdminIndicatorCatalogPage() {
    return (
        <AccessGate requireAdmin>
            <>
                <AdminSectionTabs />
                <AdminIndicatorCatalogWorkspace />
            </>
        </AccessGate>
    );
}
