import { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import type { MutableRefObject, ReactNode } from 'react';

export type PaletteOps = {
  openFile: (path: string) => void;
  // Opens a file in the editor side panel without changing the active tab
  // (used by in-chat file links so they behave like the inline edit view).
  openFileInEditor: (path: string, line?: number | null) => void;
  // Directories cannot be read as text: they open in the file tree instead.
  openDirectory: (path: string) => void;
  openSettings: (tab?: string) => void;
  refreshProjects: () => Promise<void> | void;
  // Appends text to the chat composer and focuses it (used by the quick
  // settings Commands tab to hand a picked slash command to the composer).
  insertComposerText: (text: string) => void;
  // Sends text to the open chat as a message of its own, without touching the
  // composer's text (used by the agent questions panel to deliver an answer).
  // Queued behind a running turn.
  sendChatMessage: (text: string) => Promise<void> | void;
};

type Registry = MutableRefObject<Partial<PaletteOps>>;

const PaletteOpsContext = createContext<Registry | null>(null);

const defaultOps: PaletteOps = {
  openFile: () => undefined,
  openFileInEditor: () => undefined,
  openDirectory: () => undefined,
  openSettings: () => undefined,
  refreshProjects: () => undefined,
  insertComposerText: () => undefined,
  sendChatMessage: () => undefined,
};

/** Mounted by the project-workspace module so CommandPalette and the chat, code-editor and sidebar modules share one set of palette operations. */
export function PaletteOpsProvider({ children }: { children: ReactNode }) {
  const ref = useRef<Partial<PaletteOps>>({});
  return <PaletteOpsContext.Provider value={ref}>{children}</PaletteOpsContext.Provider>;
}

export function usePaletteOps(): PaletteOps {
  const ref = useContext(PaletteOpsContext);
  return useMemo<PaletteOps>(
    () => ({
      openFile: (path) => (ref?.current.openFile ?? defaultOps.openFile)(path),
      openFileInEditor: (path, line) =>
        (ref?.current.openFileInEditor ?? defaultOps.openFileInEditor)(path, line),
      openDirectory: (path) => (ref?.current.openDirectory ?? defaultOps.openDirectory)(path),
      openSettings: (tab) => (ref?.current.openSettings ?? defaultOps.openSettings)(tab),
      refreshProjects: () => (ref?.current.refreshProjects ?? defaultOps.refreshProjects)(),
      insertComposerText: (text) =>
        (ref?.current.insertComposerText ?? defaultOps.insertComposerText)(text),
      sendChatMessage: (text) =>
        (ref?.current.sendChatMessage ?? defaultOps.sendChatMessage)(text),
    }),
    [ref],
  );
}

export function usePaletteOpsRegister(partial: Partial<PaletteOps>) {
  const ref = useContext(PaletteOpsContext);
  const {
    openFile,
    openFileInEditor,
    openDirectory,
    openSettings,
    refreshProjects,
    insertComposerText,
    sendChatMessage,
  } = partial;

  useEffect(() => {
    if (!ref) return undefined;
    // The provider creates `ref.current` once and only ever mutates its fields,
    // so capturing the registry object here is equivalent to reading
    // `ref.current` in the cleanup — and keeps the cleanup off a live ref read.
    const registry = ref.current;
    const prev = { ...registry };
    if (openFile) registry.openFile = openFile;
    if (openFileInEditor) registry.openFileInEditor = openFileInEditor;
    if (openDirectory) registry.openDirectory = openDirectory;
    if (openSettings) registry.openSettings = openSettings;
    if (refreshProjects) registry.refreshProjects = refreshProjects;
    if (insertComposerText) registry.insertComposerText = insertComposerText;
    if (sendChatMessage) registry.sendChatMessage = sendChatMessage;
    return () => {
      if (openFile && registry.openFile === openFile) registry.openFile = prev.openFile;
      if (openFileInEditor && registry.openFileInEditor === openFileInEditor) registry.openFileInEditor = prev.openFileInEditor;
      if (openDirectory && registry.openDirectory === openDirectory) registry.openDirectory = prev.openDirectory;
      if (openSettings && registry.openSettings === openSettings) registry.openSettings = prev.openSettings;
      if (refreshProjects && registry.refreshProjects === refreshProjects) registry.refreshProjects = prev.refreshProjects;
      if (insertComposerText && registry.insertComposerText === insertComposerText) registry.insertComposerText = prev.insertComposerText;
      if (sendChatMessage && registry.sendChatMessage === sendChatMessage) registry.sendChatMessage = prev.sendChatMessage;
    };
  }, [ref, openFile, openFileInEditor, openDirectory, openSettings, refreshProjects, insertComposerText, sendChatMessage]);
}
