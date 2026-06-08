#!/usr/bin/env node
'use strict';

const fs = require('fs');
const Module = require('module');
const path = require('path');

const distDir = path.resolve(__dirname, '..', '.test-dist');
const originalResolveFilename = Module._resolveFilename;

Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (typeof request === 'string' && request.startsWith('@/')) {
        const aliasedRequest = path.join(distDir, request.slice(2));
        return originalResolveFilename.call(this, aliasedRequest, parent, isMain, options);
    }

    return originalResolveFilename.call(this, request, parent, isMain, options);
};

function collectTestFiles(dir) {
    const results = [];
    if (!fs.existsSync(dir)) {
        return results;
    }

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...collectTestFiles(full));
        } else if (entry.isFile() && entry.name.endsWith('.test.js')) {
            results.push(full);
        }
    }

    return results;
}

const files = collectTestFiles(distDir);

if (files.length === 0) {
    console.log('No test files found in .test-dist/');
    process.exit(0);
}

console.log(`Running ${files.length} test file(s)...\n`);

for (const file of files) {
    require(file);
}
