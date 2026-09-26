// Loads StageLogic.js the way Stage.qml does: the shipped file, verbatim, in
// a bare context with no QML engine and no compositor. Every test file shares
// this, so none of them can drift into testing a copy.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const logicPath = path.join(root, 'StageLogic.js');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(logicPath, 'utf8'), context, { filename: logicPath });

module.exports = { StageLogic: context, root };
