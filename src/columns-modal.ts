import { Modal, setIcon, TFile, type Modifier, type TFolder } from 'obsidian';
import { CONFIG } from './config';
import { loadIconizeData, paintFolderIcon, type IconData } from './icons';
import type ColumnViewPlugin from './main';
import type { VNode } from './model';
import { foldText } from './rules';

const ROW_H = 40; // keep in sync with .vc-row min-height in styles.css

interface Column {
	folder: TFolder;
	items: VNode[];
	sel: number; // index of the selected row, -1 = none yet
	el: HTMLElement;
	list: HTMLElement;
	rows: HTMLElement[];
	rendered: number; // rows rendered so far (large folders render in batches)
}

/* Mouse and keyboard mean the same thing:
 *   click the ROW   =  →      show / enter the folder
 *   click the NAME  =  Enter  open the folder note (or the file)            */
export class ColumnsModal extends Modal {
	private plugin: ColumnViewPlugin;
	private cols: Column[] = [];
	private focusCol = 0;
	private buffer = '';
	private bufferTimer: number | undefined;
	private refreshTimer: number | undefined;
	private iconData: IconData | null = null;
	private ready = false;
	private pathEl!: HTMLElement;
	private realEl!: HTMLElement;
	private colsEl!: HTMLElement;

	constructor(plugin: ColumnViewPlugin) {
		super(plugin.app);
		this.plugin = plugin;
	}

	async onOpen(): Promise<void> {
		this.plugin.activeModal = this;
		this.modalEl.addClass('vc-modal');
		this.contentEl.addClass('vc-root');
		this.contentEl.tabIndex = -1;

		// Top: the complete path, big. Right: the one button.
		const header = this.contentEl.createDiv({ cls: 'vc-header' });
		const main = header.createDiv({ cls: 'vc-header-main' });
		this.pathEl = main.createDiv({ cls: 'vc-path' });
		this.realEl = main.createDiv({ cls: 'vc-real' });
		const locate = header.createDiv({
			cls: ['clickable-icon', 'vc-locate'],
			attr: { 'aria-label': 'Show current note (Tab)' },
		});
		setIcon(locate, 'locate-fixed');
		locate.addEventListener('click', () => this.locate());

		this.colsEl = this.contentEl.createDiv({ cls: 'vc-columns' });

		this.registerKeys();
		this.contentEl.doc.addEventListener('keydown', this.onDocKey, true);

		this.iconData = await loadIconizeData(this.app);
		const active = this.plugin.settings.openOnCurrentNote
			? this.app.workspace.getActiveFile()
			: null;
		this.restore(
			active
				? this.plugin.model.chainFor(active)
				: this.plugin.settings.lastChain,
			false,
		);
		this.ready = true;
		this.contentEl.focus({ preventScroll: true });
	}

	onClose(): void {
		this.contentEl.doc.removeEventListener('keydown', this.onDocKey, true);
		this.contentEl.win.clearTimeout(this.bufferTimer);
		this.contentEl.win.clearTimeout(this.refreshTimer);
		if (this.ready) {
			this.plugin.settings.lastChain = this.currentChain();
			void this.plugin.saveSettings();
		}
		this.plugin.activeModal = null;
		this.contentEl.empty();
	}

	/* ------------------------------------------------------------- keys */
	private registerKeys(): void {
		const reg = (mods: Modifier[], key: string, fn: () => void): void => {
			this.scope.register(mods, key, () => {
				if (this.ready) fn();
				return false;
			});
		};
		reg([], 'ArrowDown', () => this.move(1));
		reg([], 'ArrowUp', () => this.move(-1));
		reg([], 'ArrowRight', () => this.enter());
		reg([], 'ArrowLeft', () => this.leave());
		reg([], 'Backspace', () => this.leave());
		reg([], 'Home', () => this.jump(0));
		reg([], 'End', () => this.jump(Infinity));
		reg([], 'PageDown', () => this.move(this.pageSize()));
		reg([], 'PageUp', () => this.move(-this.pageSize()));
		reg([], 'Enter', () => this.activate(false));
		reg(['Mod'], 'Enter', () => this.activate(true));
		reg([], 'Tab', () => this.locate());
	}

	// Type-ahead: plain printable characters jump to the first matching name.
	private onDocKey = (e: KeyboardEvent): void => {
		if (!this.ready || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
		if (e.key.length !== 1) return;
		if (e.key === ' ' && !this.buffer) return;
		e.preventDefault();
		e.stopPropagation();
		this.typeahead(e.key);
	};

	private typeahead(ch: string): void {
		const win = this.contentEl.win;
		win.clearTimeout(this.bufferTimer);
		this.buffer += ch;
		this.bufferTimer = win.setTimeout(() => {
			this.buffer = '';
		}, 700);
		const col = this.cols[this.focusCol];
		if (!col) return;
		const q = foldText(this.buffer);
		const idx = col.items.findIndex((n) => n.fold.startsWith(q));
		if (idx >= 0) this.select(this.focusCol, idx);
	}

	private pageSize(): number {
		const col = this.cols[this.focusCol];
		return col ? Math.max(1, Math.floor(col.list.clientHeight / ROW_H) - 1) : 10;
	}

	/* ------------------------------------------------------- navigation */
	private move(delta: number): void {
		const col = this.cols[this.focusCol];
		if (!col || !col.items.length) return;
		this.select(this.focusCol, col.sel < 0 ? 0 : col.sel + delta);
	}

	private jump(idx: number): void {
		const col = this.cols[this.focusCol];
		if (col && col.items.length) this.select(this.focusCol, idx);
	}

	// →  : step into the folder shown in the next column
	private enter(): void {
		const next = this.cols[this.focusCol + 1];
		if (!next || !next.items.length) return;
		this.select(this.focusCol + 1, 0);
	}

	// ←  : step back out
	private leave(): void {
		if (this.focusCol <= 0) return;
		const ci = this.focusCol - 1;
		const col = this.cols[ci];
		if (col) this.select(ci, col.sel);
	}

	// Enter : the file, or the folder's note. A folder without a note is entered.
	private activate(newTab: boolean): void {
		const col = this.cols[this.focusCol];
		const node = col?.items[col.sel];
		if (!node) return;
		const folder = node.asFolder();
		if (folder) {
			const note = this.plugin.model.getFolderNote(folder);
			if (note) this.openFile(note, newTab);
			else this.enter();
			return;
		}
		if (node.file instanceof TFile) this.openFile(node.file, newTab);
	}

	// The button / Tab: jump back to the note that is open in the editor.
	private locate(): void {
		const active = this.app.workspace.getActiveFile();
		if (active) this.restore(this.plugin.model.chainFor(active), true);
	}

	private openFile(file: TFile, newTab: boolean): void {
		this.close();
		void this.app.workspace.getLeaf(newTab ? 'tab' : false).openFile(file);
	}

	/* ------------------------------------------------------------ state */
	private currentChain(): string[] {
		const chain: string[] = [];
		for (const col of this.cols) {
			const node = col.sel >= 0 ? col.items[col.sel] : undefined;
			if (!node) break;
			chain.push(node.file.path);
		}
		return chain;
	}

	private restore(chain: string[], smooth: boolean): void {
		this.colsEl.empty();
		this.cols = [];
		this.cols.push(this.createCol(this.plugin.model.root()));
		let ci = 0;
		let selectedAny = false;
		for (const p of chain) {
			const col = this.cols[ci];
			if (!col) break;
			const idx = col.items.findIndex((n) => n.file.path === p);
			if (idx < 0) break;
			this.select(ci, idx, false);
			selectedAny = true;
			if (col.items[idx]?.isFolder && this.cols[ci + 1]) ci++;
			else break;
		}
		if (!selectedAny) this.select(0, 0, false);
		this.centerOnFocus(smooth);
	}

	scheduleRefresh(): void {
		if (!this.ready) return;
		const win = this.contentEl.win;
		win.clearTimeout(this.refreshTimer);
		this.refreshTimer = win.setTimeout(() => {
			const fc = this.focusCol;
			this.restore(this.currentChain(), false);
			this.focusCol = Math.min(fc, this.cols.length - 1);
			this.updateActive();
			this.centerOnFocus(false);
		}, 300);
	}

	/* -------------------------------------------------------- rendering */
	private createCol(folder: TFolder): Column {
		const items = this.plugin.model.childrenOf(folder);
		const el = this.colsEl.createDiv({ cls: 'vc-col' });
		const list = el.createDiv({ cls: 'vc-list' });
		const col: Column = { folder, items, sel: -1, el, list, rows: [], rendered: 0 };
		if (!items.length) list.createDiv({ cls: 'vc-empty', text: 'Empty' });

		list.addEventListener('scroll', () => {
			if (col.rendered < col.items.length && list.scrollTop + list.clientHeight > list.scrollHeight - 600) {
				this.renderMore(col);
			}
		});
		list.addEventListener('click', (e: MouseEvent) => {
			const target = e.target instanceof Element ? e.target : null;
			const row = target?.closest('.vc-row');
			if (!target || !(row instanceof HTMLElement)) return;
			const idx = Number(row.dataset.i);
			const node = col.items[idx];
			if (!node) return;
			const newTab = e.metaKey || e.ctrlKey;

			if (node.file instanceof TFile) {
				this.openFile(node.file, newTab); // a file: click anywhere on it
				return;
			}
			const folder = node.asFolder();
			const note = folder && target.closest('.vc-name') ? this.plugin.model.getFolderNote(folder) : null;
			if (note) this.openFile(note, newTab); // click the NAME: open the folder note
			else this.select(this.cols.indexOf(col), idx); // click the ROW: show the folder
		});

		this.renderMore(col);
		return col;
	}

	private renderMore(col: Column): void {
		const end = Math.min(col.items.length, col.rendered + CONFIG.renderChunk);
		for (let i = col.rendered; i < end; i++) {
			const row = this.renderRow(col, i);
			if (row) col.rows.push(row);
		}
		col.rendered = end;
	}

	// A row is: [custom folder icon] name [>]. Nothing else.
	private renderRow(col: Column, i: number): HTMLElement | null {
		const node = col.items[i];
		if (!node) return null;
		const row = col.list.createDiv({ cls: 'vc-row' });
		row.dataset.i = String(i);
		const folder = node.asFolder();

		if (folder) {
			const icon = row.createSpan({ cls: 'vc-icon' });
			if (!paintFolderIcon(this.app, icon, folder, this.iconData)) icon.remove();
		}
		row.createSpan({ cls: 'vc-name', text: node.display });
		if (folder) {
			if (this.plugin.model.getFolderNote(folder)) row.addClass('vc-has-note'); // underlined name
			row.createSpan({ cls: 'vc-chev', text: '>' });
		}
		return row;
	}

	private select(ci: number, idx: number, center = true): void {
		const col = this.cols[ci];
		if (!col || !col.items.length) return;
		idx = Math.max(0, Math.min(col.items.length - 1, idx));
		while (col.rendered <= idx + 20 && col.rendered < col.items.length) this.renderMore(col);

		if (col.sel >= 0) col.rows[col.sel]?.removeClass('is-selected');
		col.sel = idx;
		const row = col.rows[idx];
		if (row) {
			row.addClass('is-selected');
			this.ensureVisible(col, row);
		}

		this.focusCol = ci;
		while (this.cols.length > ci + 1) this.cols.pop()?.el.remove();
		const node = col.items[idx];
		const folder = node?.asFolder();
		if (node && folder) this.cols.push(this.createCol(folder));

		this.updateActive();
		this.updateHeader(node);
		if (center) this.centerOnFocus(this.ready);
	}

	// Vertical scroll inside one column only (scrollIntoView would also scroll
	// the columns sideways and fight with the centring).
	private ensureVisible(col: Column, row: HTMLElement): void {
		const list = col.list;
		const top = row.offsetTop;
		const bottom = top + row.offsetHeight;
		if (top - ROW_H < list.scrollTop) list.scrollTop = Math.max(0, top - ROW_H);
		else if (bottom + ROW_H > list.scrollTop + list.clientHeight) list.scrollTop = bottom + ROW_H - list.clientHeight;
	}

	// The column you are working in always sits in the middle.
	private centerOnFocus(smooth: boolean): void {
		const col = this.cols[this.focusCol];
		if (!col) return;
		const left = col.el.offsetLeft - (this.colsEl.clientWidth - col.el.offsetWidth) / 2;
		this.colsEl.scrollTo({ left: Math.max(0, left), behavior: smooth ? 'smooth' : 'auto' });
	}

	private updateActive(): void {
		this.cols.forEach((c, i) => c.el.toggleClass('is-active', i === this.focusCol));
	}

	private updateHeader(node: VNode | undefined): void {
		const segments = [this.app.vault.getName()];
		for (const col of this.cols) {
			const n = col.sel >= 0 ? col.items[col.sel] : undefined;
			if (!n) break;
			segments.push(n.display);
		}
		this.pathEl.empty();
		segments.forEach((s, i) => {
			if (i > 0) this.pathEl.createSpan({ cls: 'vc-sep', text: '›' });
			this.pathEl.createSpan({ cls: i === segments.length - 1 ? ['vc-seg', 'is-last'] : ['vc-seg'], text: s });
		});

		// Only when it differs from what is shown: where the item REALLY lives.
		this.realEl.empty();
		if (node && (node.virtual || node.display !== node.original)) {
			this.realEl.setText(`Real path: ${node.file.path}`);
		}
	}
}
