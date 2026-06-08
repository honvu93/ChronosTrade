import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { MT5CredentialCipher } from '../services/trading/MT5CredentialCipher';

dotenv.config();

async function main() {
    const [, , usernameArg, accountLabelArg, outputPathArg] = process.argv;
    const username = usernameArg?.trim();
    const accountLabel = accountLabelArg?.trim();

    if (!username || !accountLabel) {
        throw new Error('Usage: node -r ts-node/register src/scripts/exportMt5TradeExecEnv.ts <username> <account-label> [output-path]');
    }

    const prisma = new PrismaClient();
    try {
        const account = await prisma.tradingAccount.findFirst({
            where: {
                label: accountLabel,
                ownerUser: {
                    username,
                },
            },
            include: {
                ownerUser: {
                    select: {
                        username: true,
                    },
                },
                credential: {
                    select: {
                        ciphertext: true,
                    },
                },
            },
        });

        if (!account) {
            throw new Error(`Trading account "${accountLabel}" for user "${username}" was not found.`);
        }

        if (!account.credential?.ciphertext) {
            throw new Error(`Trading account "${accountLabel}" does not have a stored MT5 credential.`);
        }

        const cipher = new MT5CredentialCipher(process.env);
        const credential = cipher.decrypt(account.credential.ciphertext);
        const output = [
            '# Generated from TV-GIT stored credential',
            `# user=${account.ownerUser.username}`,
            `# account=${account.label}`,
            `MT5_LOGIN=${credential.mt5Login}`,
            `MT5_PASSWORD=${credential.mt5Password}`,
            `MT5_SERVER=${credential.mt5Server}`,
            `MT5_BRIDGE_PORT=${process.env.MT5_EXEC_BRIDGE_PORT?.trim() || '8766'}`,
            '# Optional but recommended for true isolation:',
            '# MT5_TERMINAL_PATH=C:\\MT5\\trade-exec-terminal\\terminal64.exe',
            '',
        ].join('\n');

        if (outputPathArg?.trim()) {
            const resolvedPath = path.resolve(outputPathArg.trim());
            fs.writeFileSync(resolvedPath, output, 'utf8');
            console.log(`Wrote execution env to ${resolvedPath}`);
        } else {
            console.log(output);
        }
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
