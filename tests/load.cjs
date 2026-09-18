// Loads StageLogic.js the way Stage.qml does: the shipped file, verbatim, in
// a bare context with no QML engine and no compositor. Every test file shares
// this, so none of them can drift into testing a copy.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(root, 'StageLogic.js'), 'utf8'), context);

module.exports = { StageLogic: context, root };
