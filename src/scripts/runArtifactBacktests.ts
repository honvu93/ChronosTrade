import {
    printPersistXauNewLogicBaseBacktestsUsage,
    runPersistXauNewLogicBaseBacktests,
} from './persistXauNewLogicBaseBacktests';

type ArtifactTarget = 'xau-new-base';

function printUsage() {
    console.log([
        'Usage:',
        '  npx ts-node src/scripts/runArtifactBacktests.ts --list-targets',
        '  npx ts-node src/scripts/runArtifactBacktests.ts --target xau-new-base --list-logics',
        '  npx ts-node src/scripts/runArtifactBacktests.ts --target xau-new-base --logic all',
        '  npx ts-node src/scripts/runArtifactBacktests.ts --target xau-new-base --logic l4 --out .artifacts/xau-new-logics-2026-03-16/l4_runs.json',
        '',
        'Targets:',
        '  xau-new-base        Persist XAU new logic base backtests into DB',
        '',
        'Options:',
        '  --list-targets      Show available artifact targets',
        '  --target <name>     Artifact target to execute',
        '  --list-logics       Forwarded to the selected target when supported',
        '  --logic <keys>      Forwarded to the selected target when supported',
        '  --out <path>        Forwarded to the selected target when supported',
    ].join('\n'));
}

function parseArgs(argv: string[]) {
    const passthroughArgs: string[] = [];
    let listTargets = false;
    let target: ArtifactTarget | null = 'xau-new-base';

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];

        if (arg === '--list-targets') {
            listTargets = true;
            continue;
        }

        if (arg === '--target') {
            const value = argv[index + 1];
            if (!value) {
                throw new Error('--target requires a value.');
            }
            if (value !== 'xau-new-base') {
                throw new Error(`Unknown --target "${value}".`);
            }
            target = value;
            index += 1;
            continue;
        }

        if (arg === '--list-logics' || arg === '--logic' || arg === '--out') {
            passthroughArgs.push(arg);
            if (arg !== '--list-logics') {
                const value = argv[index + 1];
                if (!value) {
                    throw new Error(`${arg} requires a value.`);
                }
                passthroughArgs.push(value);
                index += 1;
            }
            continue;
        }

        throw new Error(`Unknown argument "${arg}".`);
    }

    return {
        listTargets,
        target,
        passthroughArgs,
    };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    if (args.listTargets) {
        console.log('- xau-new-base: Persist XAU new logic base backtests into DB');
        return;
    }

    if (args.target === 'xau-new-base') {
        await runPersistXauNewLogicBaseBacktests(args.passthroughArgs);
        return;
    }

    throw new Error('No artifact target selected.');
}

main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    printUsage();
    console.error('');
    printPersistXauNewLogicBaseBacktestsUsage();
    process.exit(1);
});
