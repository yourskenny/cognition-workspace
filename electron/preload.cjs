const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('cognition', {
  load: () => ipcRenderer.invoke('workspace:load'),
  command: command => ipcRenderer.invoke('workspace:command', command),
  history: () => ipcRenderer.invoke('workspace:history'),
  settings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: data => ipcRenderer.invoke('settings:save', data),
  deleteKey: () => ipcRenderer.invoke('settings:delete'),
  runAgent: data => ipcRenderer.invoke('agent:run', data),
  cancelAgent: () => ipcRenderer.invoke('agent:cancel'),
  exportNotes: () => ipcRenderer.invoke('workspace:export'),
  openData: () => ipcRenderer.invoke('workspace:open'),
  onAgentEvent: callback => { const listener = (_event, data) => callback(data); ipcRenderer.on('agent:event', listener); return () => ipcRenderer.removeListener('agent:event', listener); }
});
