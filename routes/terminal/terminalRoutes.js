let express = require('express');
let terminalRouters = express.Router();
const terminalController = require('../../controllers/terminalController');

/* POST users listing. */
terminalRouters.post('/api/test', terminalController.test);
terminalRouters.post('/api/askAi', terminalController.askAi);
terminalRouters.post('/api/startOllama', terminalController.startOllama);
terminalRouters.post('/api/askAiStreamVer', terminalController.askAiStreamVer);




module.exports = terminalRouters;