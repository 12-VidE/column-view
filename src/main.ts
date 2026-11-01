import { Plugin } from 'obsidian';
import { ColumnsModal } from './columns-modal';
import { VaultModel } from './model';
import {
	ColumnViewSettings,
	ColumnViewSettingTab,
	DEFAULT_SETTINGS,
} from './settings';

export default class ColumnViewPlugin extends Plugin {
	settings!: ColumnViewSettings;
	model!: VaultModel;
	activeModal: ColumnsModal | null = null;

	async onload() {
		await this.loadSettings();
		this.model = new VaultModel(this.app);

		// This creates an icon in the left ribbon.
		this.addRibbonIcon('columns-3', 'Column view', (_evt: MouseEvent) => {
			// Called when the user clicks the icon.
			this.openBrowser();
		});

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: 'open-browser',
			name: 'Open browser',
			callback: () => {
				this.openBrowser();
			},
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new ColumnViewSettingTab(this.app, this));

		// Any change to files or links can alter the virtual tree. These events
		// are removed automatically when the plugin is disabled.
		const changed = () => {
			this.model.invalidate();
			this.activeModal?.scheduleRefresh();
		};
		this.registerEvent(this.app.vault.on('create', changed));
		this.registerEvent(this.app.vault.on('delete', changed));
		this.registerEvent(this.app.vault.on('rename', changed));
		this.registerEvent(this.app.metadataCache.on('changed', changed));
		this.registerEvent(this.app.metadataCache.on('resolved', changed));
	}

	onunload() {
		this.activeModal?.close();
	}

	openBrowser() {
		if (this.activeModal) return;
		new ColumnsModal(this).open();
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<ColumnViewSettings>,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
