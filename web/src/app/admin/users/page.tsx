import AccessGate from "@/components/auth/AccessGate";
import AdminSectionTabs from "@/components/admin/AdminSectionTabs";
import AdminUsersWorkspace from "@/components/admin/AdminUsersWorkspace";

export default function AdminUsersPage() {
    return (
        <AccessGate requireAdmin>
            <>
                <AdminSectionTabs />
                <AdminUsersWorkspace />
            </>
        </AccessGate>
    );
}
