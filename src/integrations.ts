import type { App } from 'obsidian';

export const ICONIZE_ID = 'obsidian-icon-folder';
export const FOLDER_NOTES_ID = 'folder-notes';

interface PluginRegistry {
	plugins?: Record<string, unknown>;
}

export function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null;
}

// `app.plugins` is not part of Obsidian's public typings, so it is read defensively.
export function getExternalPlugin(app: App, id: string): Record<string, unknown> | null {
	const registry = (app as unknown as { plugins?: PluginRegistry }).plugins;
	const pl = registry?.plugins?.[id];
	return isRecord(pl) ? pl : null;
}

// The "folder note name" template of the Folder Notes plugin, e.g. "@{{folder_name}}".
export function folderNoteNameTemplate(app: App): string | null {
	const settings = getExternalPlugin(app, FOLDER_NOTES_ID)?.settings;
	if (!isRecord(settings)) return null;
	const tpl = settings.folderNoteName;
	return typeof tpl === 'string' && tpl ? tpl : null;
}
