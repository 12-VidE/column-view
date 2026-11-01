import { App, PluginSettingTab, Setting } from 'obsidian';
import ColumnViewPlugin from './main';

export interface ColumnViewSettings {
	// Open on the note you are editing. When off, reopen where you left it.
	openOnCurrentNote: boolean;
	// Remembered position: kept in data.json, not shown in the settings tab.
	lastChain: string[];
}

export const DEFAULT_SETTINGS: ColumnViewSettings = {
	openOnCurrentNote: true,
	lastChain: [],
};

// The rules themselves (which folders, which headings, how names are shortened)
// are NOT settings: they live in code, in config.ts and rules.ts.
export class ColumnViewSettingTab extends PluginSettingTab {
	plugin: ColumnViewPlugin;

	constructor(app: App, plugin: ColumnViewPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Open on the current note')
			.setDesc('When off, the browser reopens where you left it.')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.openOnCurrentNote)
					.onChange(async (value) => {
						this.plugin.settings.openOnCurrentNote = value;
						await this.plugin.saveSettings();
					}),
			);
	}
}
