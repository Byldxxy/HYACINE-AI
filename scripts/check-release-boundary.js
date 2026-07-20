/** Fail CI when source/build output contains known private runtime resources. */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: projectRoot })
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
const forbiddenTracked = tracked.filter(file => (
    file === '.env'
    || file.startsWith('data/')
    || file.startsWith('public/models/')
    || file.startsWith('public/models_fengjin/')
    || /^public\/(?:character|tray_icon)\./.test(file)
    || file === 'public/pet-manifest.json'
));

function walk(directory, prefix = '') {
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const relative = path.join(prefix, entry.name);
        return entry.isDirectory()
            ? walk(path.join(directory, entry.name), relative)
            : [relative.replace(/\\/g, '/')];
    });
}

const forbiddenBuild = walk(path.join(projectRoot, 'dist')).filter(file => (
    /(^|\/)(?:data|models|models_fengjin)(\/|$)/i.test(file)
    || /(^|\/)\.env(?:\.|$)/i.test(file)
    || /(^|\/)(?:bot-config|bot-sessions|bot-summaries|bot-persistent-memory)\.json$/i.test(file)
    || /\.(?:pmx|pmd|vmd)$/i.test(file)
));

if (forbiddenTracked.length || forbiddenBuild.length) {
    console.error('Release boundary check failed.');
    forbiddenTracked.forEach(file => console.error(`Tracked private resource: ${file}`));
    forbiddenBuild.forEach(file => console.error(`Bundled private resource: ${file}`));
    process.exit(1);
}

console.log(`Release boundary passed (${tracked.length} tracked files checked).`);
