import { setIcon, type App, type TFolder } from 'obsidian';
import { getExternalPlugin, ICONIZE_ID, isRecord } from './integrations';

/* The only icon this view ever shows is a CUSTOM FOLDER ICON set through Iconize.
 * Iconize stores icons as   path -> "IconName" | { iconName, iconColor }.
 * Icons are looked up by REAL path, so a folder mounted in two places shows the
 * same icon in both. Files never get an icon. Not handled: Iconize custom rules
 * and inherited folder icons. */

export type IconData = Record<string, unknown>;

interface IconizeIcon {
	svgElement?: unknown;
	svgContent?: unknown;
}

interface IconizeApi {
	getIconByName?: (name: string) => IconizeIcon | null | undefined;
	util?: {
		dom?: {
			setIconForNode?: (plugin: unknown, name: string, el: HTMLElement, color?: string) => void;
		};
	};
}

export async function loadIconizeData(app: App): Promise<IconData | null> {
	const pl = getExternalPlugin(app, ICONIZE_ID);
	if (!pl) return null;
	if (isRecord(pl.data)) return pl.data;
	try {
		const raw = await app.vault.adapter.read(`${app.vault.configDir}/plugins/${ICONIZE_ID}/data.json`);
		const parsed: unknown = JSON.parse(raw);
		return isRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function insertSvg(el: HTMLElement, svgText: string): void {
	const text = /xmlns=/.test(svgText) ? svgText : svgText.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
	const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
	const svg = doc.documentElement;
	if (svg.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) throw new Error('bad svg');
	el.empty();
	el.appendChild(el.ownerDocument.importNode(svg, true));
}

function kebab(s: string): string {
	return s
		.replace(/([a-z0-9])([A-Z])/g, '$1-$2')
		.replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
		.toLowerCase();
}

// Paints the folder's custom icon into `el`. Returns false when the folder has
// none (or it cannot be drawn), so the caller can leave the row bare.
export function paintFolderIcon(app: App, el: HTMLElement, folder: TFolder, data: IconData | null): boolean {
	const entry = data ? data[folder.path] : undefined;
	let name: string | null = null;
	let color: string | null = null;
	if (typeof entry === 'string') {
		name = entry;
	} else if (isRecord(entry)) {
		if (typeof entry.iconName === 'string') name = entry.iconName;
		if (typeof entry.iconColor === 'string') color = entry.iconColor;
	}
	return !!name && paintIconize(app, el, name, color);
}

function paintIconize(app: App, el: HTMLElement, name: string, color: string | null): boolean {
	if (/[^\x00-\x7F]/.test(name)) {
		el.setText(name); // emoji
		return true;
	}
	const pl = getExternalPlugin(app, ICONIZE_ID);
	const api = pl && isRecord(pl.api) ? (pl.api as IconizeApi) : null;

	try { // 1) ask Iconize for the SVG
		const icon = api?.getIconByName?.(name);
		const svg = icon?.svgElement ?? icon?.svgContent;
		if (typeof svg === 'string' && svg.includes('<svg')) {
			insertSvg(el, svg);
			if (color) el.setCssProps({ color });
			return true;
		}
	} catch {
		el.empty();
	}

	try { // 2) let Iconize paint the element itself
		const setIconForNode = api?.util?.dom?.setIconForNode;
		if (setIconForNode) {
			setIconForNode(pl, name, el, color ?? undefined);
			if (el.firstChild) return true;
		}
	} catch {
		el.empty();
	}

	const m = /^Li([A-Z0-9].*)$/.exec(name); // 3) Lucide pack == Obsidian's built-in icons
	if (m && m[1]) {
		setIcon(el, kebab(m[1]));
		if (el.firstChild) {
			if (color) el.setCssProps({ color });
			return true;
		}
		el.empty();
	}
	return false;
}
