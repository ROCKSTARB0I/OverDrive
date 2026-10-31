// Tells the game it is the PC build and which online server to use (see config.json).
const { contextBridge } = require('electron');
const config = require('./config.json');
contextBridge.exposeInMainWorld('overdriveDesktop', { platform: 'PC', server: config.server || '' });
