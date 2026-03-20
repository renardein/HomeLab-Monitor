/**
 * Слияние переводов из patches/<lang>.json в modules/locales/<lang>.json
 * Запуск из корня проекта: node modules/locales/patches/apply-patches.js
 */
const fs = require('fs');
const path = require('path');

const localesDir = path.join(__dirname, '..');
const patchesDir = __dirname;

const langs = ['de', 'fr', 'by', 'jp', 'cn-tr', 'ru'];

for (const lang of langs) {
    const patchPath = path.join(patchesDir, `${lang}.json`);
    if (!fs.existsSync(patchPath)) {
        console.warn('skip (no patch):', lang);
        continue;
    }
    const localePath = path.join(localesDir, `${lang}.json`);
    const loc = JSON.parse(fs.readFileSync(localePath, 'utf8'));
    const patch = JSON.parse(fs.readFileSync(patchPath, 'utf8'));
    Object.assign(loc, patch);
    fs.writeFileSync(localePath, JSON.stringify(loc, null, 4) + '\n', 'utf8');
    console.log('patched', lang, Object.keys(patch).length, 'keys');
}
