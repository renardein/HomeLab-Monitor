#!/usr/bin/env node
/**
 * Compare all modules/locales/*.json key sets vs union of keys.
 * Exit 1 if any language is missing keys.
 */
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'modules', 'locales');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));

const langs = {};
for (const f of files) {
    const code = path.basename(f, '.json');
    langs[code] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
}

const allKeys = new Set();
for (const obj of Object.values(langs)) {
    Object.keys(obj).forEach((k) => allKeys.add(k));
}

let hasMissing = false;
const report = [];

for (const lang of Object.keys(langs).sort()) {
    const ks = new Set(Object.keys(langs[lang]));
    const missing = [...allKeys].filter((k) => !ks.has(k)).sort();
    const extra = [...ks].filter((k) => !allKeys.has(k));
    if (missing.length) {
        hasMissing = true;
        report.push({ lang, missing, extra });
    } else if (extra.length) {
        report.push({ lang, missing: [], extra });
    }
}

console.log('Locale files:', files.join(', '));
console.log('Union key count:', allKeys.size);
for (const { lang, missing, extra } of report) {
    if (missing.length) {
        console.log('\n[' + lang + '] MISSING ' + missing.length + ' keys:');
        missing.forEach((k) => console.log('  -', k));
    }
    if (extra.length) {
        console.log('\n[' + lang + '] EXTRA ' + extra.length + ' keys (not in union):');
        extra.forEach((k) => console.log('  +', k));
    }
}

if (!hasMissing && report.every((r) => !r.extra || !r.extra.length)) {
    console.log('\nOK: all languages contain all union keys.');
}

process.exit(hasMissing ? 1 : 0);
