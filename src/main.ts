import { PrismaClient } from '@prisma/client';
import { ApiServer } from './server';
import dotenv from 'dotenv';
import { assertAuthReleaseCutConfig } from './services/auth/config';
import { assertRequiredDatabaseSchema } from './database/requiredDatabaseSchema';

dotenv.config();

const prisma = new PrismaClient();

async function main() {
    console.log('Starting TV-GIT backend...');

    try {
        assertAuthReleaseCutConfig();
    } catch (error: any) {
        console.error('[Main] Invalid auth release configuration:', error.message);
        process.exit(1);
    }

    try {
        console.log('[Main] Connecting to database...');
        await prisma.$connect();
        await assertRequiredDatabaseSchema(prisma);
        console.log('[Main] Database connected');
    } catch (error: any) {
        console.error('[Main] Failed to connect to database:', error.message);

        if (error.message.includes('prisma://') || error.message.includes('prisma+postgres://')) {
            console.error('\n' + '='.repeat(60));
            console.error('PRISMA CONNECTION ERROR (PROTOCOL MISMATCH)');
            console.error('Fix: run these commands to clean and regenerate Prisma Client:');
            console.error('1. Remove-Item -Recurse -Force node_modules/.prisma');
            console.error('2. npx prisma generate');
            console.error('='.repeat(60) + '\n');
        }

        process.exit(1);
    }

    const apiServer = new ApiServer();
    const port = 3001;
    apiServer.start(port);

    process.on('SIGINT', async () => {
        console.log('Stopping system...');
        await prisma.$disconnect();
        process.exit(0);
    });
}

main().catch((error) => {
    console.error('Fatal error in main:', error);
    process.exit(1);
});
