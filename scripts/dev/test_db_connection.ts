import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();

async function test() {
    console.log('Testing connection...');
    console.log('DATABASE_URL:', process.env.DATABASE_URL);
    try {
        await prisma.$connect();
        console.log('SUCCESS: Connected to database.');
    } catch (e: any) {
        console.error('FAILURE: Could not connect.');
        console.error(e.message);
    } finally {
        await prisma.$disconnect();
    }
}

test();
