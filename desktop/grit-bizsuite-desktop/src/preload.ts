// IPC bridge — the renderer runs with nodeIntegration off and
// contextIsolation on, so this is the only surface it gets into the main
// process: poll status, open an app in the system browser, quit.
import { contextBridge, ipcRenderer } from "electron";

export interface AppStatusEntry {
  id: string;
  label: string;
  status: "stopped" | "starting" | "running" | "crashed";
  port: number;
}

contextBridge.exposeInMainWorld("gritDesktop", {
  getAllStatus: (): Promise<AppStatusEntry[]> => ipcRenderer.invoke("get-all-status"),
  openApp: (id: string): Promise<void> => ipcRenderer.invoke("open-app", id),
  quit: (): Promise<void> => ipcRenderer.invoke("quit-app"),
  onStatus: (callback: (entry: AppStatusEntry) => void) => {
    ipcRenderer.on("app-status", (_event, entry: AppStatusEntry) => callback(entry));
  },
  onBootError: (callback: (message: string) => void) => {
    ipcRenderer.on("boot-error", (_event, message: string) => callback(message));
  },
});
