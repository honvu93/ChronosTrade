import AccessGate from '@/components/auth/AccessGate';
import MainLayout from '@/components/layout/MainLayout';
import SignalComposerPage from '@/components/signals/SignalComposerPage';

export default function ComposerRoute() {
    return (
        <AccessGate requiredModules={["signal"]}>
            <MainLayout>
                <SignalComposerPage />
            </MainLayout>
        </AccessGate>
    );
}
