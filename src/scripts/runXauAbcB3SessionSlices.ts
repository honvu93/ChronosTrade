import { DEFAULT_OUT_DIR, VariantSpec, runVariantGroup, setLondonSession } from './xauAbcOptimizationShared';

const VARIANTS: VariantSpec[] = [
    {
        id: 'b3_london_07_09_hard',
        label: 'B3 - London 07-09 + HARD_SIGNAL_TP',
        changeSummary: 'Restrict M5 continuation entries to the first two London hours (07:00-09:00 UTC).',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            setLondonSession(definition, 7, 9);
        },
    },
    {
        id: 'b3_london_07_10_hard',
        label: 'B3 - London 07-10 + HARD_SIGNAL_TP',
        changeSummary: 'Restrict M5 continuation entries to the first three London hours (07:00-10:00 UTC).',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            setLondonSession(definition, 7, 10);
        },
    },
    {
        id: 'b3_london_08_10_hard',
        label: 'B3 - London 08-10 + HARD_SIGNAL_TP',
        changeSummary: 'Focus M5 continuation entries on the post-open expansion pocket (08:00-10:00 UTC).',
        exitProfile: 'HARD_SIGNAL_TP',
        mutate(definition) {
            setLondonSession(definition, 8, 10);
        },
    },
];

runVariantGroup({
    group: 'b3_session_slices',
    groupLabel: 'B3 - M5 London session slices',
    variants: VARIANTS,
    defaultOutPath: `${DEFAULT_OUT_DIR}/b3_session_slices.json`,
}).catch((error) => {
    console.error(error);
    process.exit(1);
});
