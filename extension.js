const UUID = "OSDcustomizer@sewbej";
const Clutter = imports.gi.Clutter;
const Gdk = imports.gi.Gdk;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const Meta = imports.gi.Meta;
const St = imports.gi.St;
const Pango = imports.gi.Pango;
const Util = imports.misc.util;

const BarLevel = imports.ui.barLevel;
const Layout = imports.ui.layout;
const Main = imports.ui.main;
const OsdWindowOriginal = imports.ui.osdWindow;
const Settings = imports.ui.settings;

const LEVEL_ANIMATION = Clutter.AnimationMode.EASE_OUT_EXPO;
const FADE_IN_ANIMATION = Clutter.AnimationMode.EASE_OUT_QUART;
const FADE_OUT_ANIMATION = Clutter.AnimationMode.EASE_IN_QUART;

function convertGdkIndex(monitorIndex) {
	let screen = Gdk.Screen.get_default();
	let rect = screen.get_monitor_geometry(monitorIndex);
	let cx = rect.x + rect.width / 2;
	let cy = rect.y + rect.height / 2;
	for (let i = 0; i < Main.layoutManager.monitors.length; i++) {
		let monitor = Main.layoutManager.monitors[i];
		if (cx >= monitor.x && cx < monitor.x + monitor.width &&
			cy >= monitor.y && cy < monitor.y + monitor.height)
			monitorIndex = i;
	}
	return monitorIndex;
}

if (!global.OsdWithNumberWindowCustom) {
	global.OsdWithNumberWindowCustom = GObject.registerClass({
		GTypeName: 'OsdWithNumberWindowCustom'
	}, class OsdWithNumberWindowCustom extends Clutter.Actor {
		_init(monitorIndex, manager) {
			super._init({
				x_expand: true,
				y_expand: true,
				x_align: Clutter.ActorAlign.START,
				y_align: Clutter.ActorAlign.START,
			});

			this._monitorIndex = monitorIndex;
			this._manager = manager;

			this._constraint = new Layout.MonitorConstraint({
				index: monitorIndex,
				work_area: false,
			});
			this.add_constraint(this._constraint);

			this._hbox = new St.BoxLayout({
				style_class: 'media-keys-osd',
				important: true,
			});
			this.add_actor(this._hbox);

			this._icon = new St.Icon({
				y_expand: true
			});
			this._percentage = new St.Label({
				style_class: 'level-number',
				y_align: Clutter.ActorAlign.CENTER,
				x_align: Clutter.ActorAlign.CENTER,
			});

			this._vbox = new St.BoxLayout({
				vertical: true,
				x_align: Clutter.ActorAlign.CENTER,
				y_align: Clutter.ActorAlign.CENTER,
			});

			this._label = new St.Label();
			this._vbox.add_child(this._label);

			this._systemLevel = new BarLevel.BarLevel({
				style_class: 'level',
				value: 0,
			});
			this._vbox.add_child(this._systemLevel);

			this._customBarBg = new St.Bin({
				important: true
			});
			this._customBarFill = new St.Widget({
				important: true
			});
			this._customBarBg.set_child(this._customBarFill);
			this._vbox.add_child(this._customBarBg);

			this._hideTimeoutId = 0;
			this._positionLocked = false;
			this.connect('notify::allocation', () => this.updateStyle());

			this.updateStyle();
			this._reset();
			Main.uiGroup.add_child(this);
		}

		updateStyle() {
			let monitor = Main.layoutManager.monitors[this._monitorIndex];
			let useCustom = this._manager.barlevelCustom;
			let isVertical = (this._manager.osdOrientation === "vertical") && useCustom;

			this._hbox.remove_all_children();

			if (isVertical) {
				this._hbox.add_child(this._percentage);
				this._hbox.add_child(this._vbox);
				this._hbox.add_child(this._icon);
				this._percentage.style = 'margin: 0;';
				this._icon.style = 'margin: 0;';
			} else {
				this._hbox.add_child(this._icon);
				this._hbox.add_child(this._vbox);
				this._hbox.add_child(this._percentage);
				this._icon.style = 'margin: 0;';
				this._percentage.style = 'margin: 0;';
			}

			this._hbox.vertical = isVertical;
			this._vbox.vertical = !isVertical;

			if (this._manager.osdBackgdColorCustom) {
				const allStyles = ['pane', 'tempered'];
				const allColors = ['azure', 'cinnamon', 'crimson', 'falcon', 'grey', 'mint', 'nordic', 'steel', 'violet'];

				allStyles.forEach(style => {
					allColors.forEach(color => {
						this._hbox.remove_style_class_name(`osd-style-${style}-${color}`);
					});
				});

				let currentStyle = this._manager.surfaceStyleOSD;
				let currentColor = this._manager.semabeColor ? this._manager.semabeColor.toLowerCase() : 'steel';

				let isCustomColor = (currentColor === 'custom-color');

				if (currentStyle !== "disabled" && !isCustomColor) {
					let dynamicClassName = `osd-style-${currentStyle}-${currentColor}`;
					this._hbox.add_style_class_name(dynamicClassName);
				}

				if (isCustomColor) {
					this._hbox.style = `
        box-shadow: none;
        padding: ${this._manager.osdOrientation === 'horizontal' ? `${this._manager.OSDwidth}px 0px ${this._manager.OSDwidth}px 16px` : `10px ${this._manager.OSDwidth}px`};
        background-color: ${this._manager.osdBackgdColor1};
        background-gradient-direction: vertical;
        background-gradient-start: ${this._manager.osdBackgdColor1};
        background-gradient-end: ${this._manager.osdBackgdColor2};
        background-blur: ${this._manager.osdBackgdBlur}px;
        background-bumpmap: ${this._manager.lightRefraction === 'none' ? 'none' : `url("${GLib.get_home_dir()}/.local/share/cinnamon/extensions/OSDcustomizer@sewbej/refraction/${this._manager.lightRefraction}")`};
        border: ${this._manager.osdBorderThick}px solid ${this._manager.osdBorderColor};
        border-radius: ${this._manager.osdBorderRadius}px;
    `;
				} else if (currentStyle !== "disabled") {
					this._hbox.style = `
        padding: ${this._manager.osdOrientation === 'horizontal' ? `${this._manager.OSDwidth}px 0px ${this._manager.OSDwidth}px 16px` : `10px ${this._manager.OSDwidth}px`};
        background-blur: ${this._manager.osdBackgdBlur}px;
        background-bumpmap: ${this._manager.lightRefraction === 'none' ? 'none' : `url("${GLib.get_home_dir()}/.local/share/cinnamon/extensions/OSDcustomizer@sewbej/refraction/${this._manager.lightRefraction}")`};
        border-radius: ${this._manager.osdBorderRadius}px;
    `;
				} else {
					this._hbox.style = `
        padding: ${this._manager.osdOrientation === 'horizontal' ? `${this._manager.OSDwidth}px 0px ${this._manager.OSDwidth}px 16px` : `10px ${this._manager.OSDwidth}px`};
        background-blur: ${this._manager.osdBackgdBlur}px;
        background-bumpmap: ${this._manager.lightRefraction === 'none' ? 'none' : `url("${GLib.get_home_dir()}/.local/share/cinnamon/extensions/OSDcustomizer@sewbej/refraction/${this._manager.lightRefraction}")`};
        border-radius: ${this._manager.osdBorderRadius}px;
    `;
				}
			} else {
				this._hbox.style = null;
			}

			if (useCustom) {
				this._systemLevel.hide();
				this._customBarBg.show();

				this._customBarBg.style = `background-color: ${this._manager.barlevelBackgdColor}; border-radius: ${this._manager.barlevelRadius}px;`;
				this._customBarFill.style = `background-color: ${this._manager.barlevelForegdColor}; border-radius: ${this._manager.barlevelRadius}px;`;

				let floatValue = this._systemLevel.value;
				if (isNaN(floatValue) || floatValue === null || floatValue === 0) {
					let currentText = this._percentage.get_text();
					if (currentText) floatValue = parseInt(currentText) / 100;
				}

				let maxDim = this._manager.barlevelDim;
				let thick = this._manager.barlevelThick;
				let targetSize = Math.round((floatValue || 0) * maxDim);

				if (isVertical) {
					this._customBarBg.set_size(thick, maxDim);
					this._customBarFill.width = thick;
					this._customBarFill.height = targetSize;

					let offset = (maxDim - targetSize) / 2;
					this._customBarFill.translation_y = offset;
					this._customBarFill.translation_x = 0;
				} else {
					this._customBarBg.set_size(maxDim, thick);
					this._customBarFill.height = thick;
					this._customBarFill.width = targetSize;

					let offset = (targetSize - maxDim) / 2;
					this._customBarFill.translation_x = offset;
					this._customBarFill.translation_y = 0;
				}
			} else {
				this._systemLevel.show();
				this._customBarBg.hide();
				this._customBarFill.translation_x = 0;
				this._customBarFill.translation_y = 0;
			}

			if (monitor && !this._positionLocked) {
				let availWidth = monitor.width - this._hbox.width;
				let availHeight = monitor.height - this._hbox.height;
				this._hbox.translation_x = Math.round(availWidth * (this._manager.xAlign / 100));
				this._hbox.translation_y = Math.round(availHeight * (this._manager.yAlign / 100));

				if (this._hbox.width > 0 && this.visible) {
					this._positionLocked = true;
				}
			}

			let fontDesc = Pango.FontDescription.from_string(this._manager.fontSelect);
			let fontFamily = fontDesc.get_family();
			let fontWeight = this._manager.fontBold ? 'bold' : 'normal';
			let fontStyle = this._manager.fontItalic ? 'italic' : 'normal';
			let textStyle = `font-family: '${fontFamily}'; font-size: ${this._manager.fontSize}%; font-weight: ${fontWeight}; font-style: ${fontStyle}; `;
			if (this._manager.textShadowCustom) {
				textStyle += `color: ${this._manager.textColor}; text-shadow: ${this._manager.shadowColor} 1px 1.6px 1.1px 0px;`;
			}
			this._percentage.set_style(textStyle);

			let calculatedSize = Math.round(32 * (this._manager.iconSize / 100));
			let iconStyle = `icon-size: ${calculatedSize}px; `;
			if (this._manager.iconColorCustom) {
				iconStyle += `color: ${this._manager.iconColor}; icon-shadow: ${this._manager.iconShadowColor} 1px 1.6px 1.1px 0px;`;
			}
			this._icon.set_style(iconStyle);
		}

		setLevel(value) {
			if (value === null) return;

			this._manager._onAppearanceChanged();

			if (this._blurRedrawId) GLib.source_remove(this._blurRedrawId);

			let startTime = GLib.get_monotonic_time();
			let maxRedrawTime = this._manager.hideTimeout * 1000;

			this._blurRedrawId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 48, () => {
				this._hbox.queue_redraw();

				let now = GLib.get_monotonic_time();
				if (now - startTime > maxRedrawTime) {
					this._manager._onAppearanceChanged();
					this._blurRedrawId = 0;
					return GLib.SOURCE_REMOVE;
				}
				return GLib.SOURCE_CONTINUE;
			});

			let floatValue = value / 100;
			let intValue = value.toString();

			if (this._manager.barlevelCustom) {
				let isVertical = this._manager.osdOrientation === "vertical";
				let maxDim = this._manager.barlevelDim;
				let targetSize = Math.round(floatValue * maxDim);

				if (isVertical) {
					this._customBarFill.width = this._manager.barlevelThick;
					let offset = (maxDim - targetSize) / 2;
					this._customBarFill.ease({
						height: targetSize,
						translation_y: offset,
						duration: this._manager.levelTime,
						mode: LEVEL_ANIMATION
					});
				} else {
					this._customBarFill.height = this._manager.barlevelThick;
					let offset = (targetSize - maxDim) / 2;
					this._customBarFill.ease({
						width: targetSize,
						translation_x: offset,
						duration: this._manager.levelTime,
						mode: LEVEL_ANIMATION
					});
				}
			} else {
				this._systemLevel.ease_property('value', floatValue, {
					mode: LEVEL_ANIMATION,
					duration: this._manager.levelTime
				});
			}
			this._percentage.set_text(intValue);
		}

		setIcon(icon) {
			this._icon.gicon = icon;
		}
		setLabel(label) {
			this._label.visible = label != null;
			if (this._label.visible) {
				this._label.text = label;
				this._percentage.hide();
			} else {
				this._percentage.show();
			}
		}
		setMaxLevel(maxLevel = 1) {
			this._systemLevel.maximum_value = maxLevel;
		}

		show() {
			if (!this._icon.gicon) return;
			if (!this.visible) {
				Meta.disable_unredirect_for_display(global.display);
				super.show();
				this.opacity = 0;
				this.get_parent().set_child_above_sibling(this, null);
				this.ease({
					opacity: 255,
					duration: this._manager.fadeInTime,
					mode: FADE_IN_ANIMATION,
				});
			}
			if (this._hideTimeoutId) GLib.source_remove(this._hideTimeoutId);
			this._hideTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._manager.hideTimeout, this._hide.bind(this));
		}

		cancel() {
			if (!this._hideTimeoutId) return;
			GLib.source_remove(this._hideTimeoutId);
			this._hide();
		}

		_hide() {

			this._hideTimeoutId = 0;
			if (this._blurRedrawId) {
				GLib.source_remove(this._blurRedrawId);
				this._blurRedrawId = 0;
			}
			this.ease({
				opacity: 0,
				duration: this._manager.fadeOutTime,
				mode: FADE_OUT_ANIMATION,
				onComplete: () => {
					this._reset();
					Meta.enable_unredirect_for_display(global.display);
					Util.spawnCommandLine(
						`cinnamon-dbus-command ReloadXlet OSDcustomizer@sewbej EXTENSION`
					);
				},
			});
			return GLib.SOURCE_REMOVE;
		}

		_reset() {
			super.hide();
			this._positionLocked = false;
			this.setLabel(null);
			this.setMaxLevel(null);
		}

		destroy() {

			if (this._hideTimeoutId) GLib.source_remove(this._hideTimeoutId);

			if (this._blurRedrawId) {
				GLib.source_remove(this._blurRedrawId);
				this._blurRedrawId = 0;
			}
			super.destroy();
		}
	});
}

const OsdWithNumberWindow = global.OsdWithNumberWindowCustom;

var CustomOsdWindowManager = class {
	constructor(metadata) {
		this._osdWindows = [];
		this._settings = new Settings.ExtensionSettings(this, metadata.uuid);
		this._bindSettings();
		this._monitorsChangedId = Main.layoutManager.connect('monitors-changed', this._layoutChanged.bind(this));
		this._osdSettings = new Gio.Settings({
			schema_id: "org.cinnamon"
		});
		this._osdSettingsId = this._osdSettings.connect("changed::show-media-keys-osd", this._layoutChanged.bind(this));
		this._layoutChanged();
	}

	_bindSettings() {
		this._settings.bind("barlevel-custom", "barlevelCustom", this._onAppearanceChanged.bind(this));
		this._settings.bind("OSD-orientation", "osdOrientation", this._onAppearanceChanged.bind(this));
		this._settings.bind("barlevel-dim", "barlevelDim", this._onAppearanceChanged.bind(this));
		this._settings.bind("barlevel-thick", "barlevelThick", this._onAppearanceChanged.bind(this));
		this._settings.bind("barlevel-radius", "barlevelRadius", this._onAppearanceChanged.bind(this));
		this._settings.bind("barlevel-backgd-color", "barlevelBackgdColor", this._onAppearanceChanged.bind(this));
		this._settings.bind("barlevel-foregd-color", "barlevelForegdColor", this._onAppearanceChanged.bind(this));
		this._settings.bind("level-time", "levelTime");
		this._settings.bind("fade-in-time", "fadeInTime");
		this._settings.bind("fade-out-time", "fadeOutTime");
		this._settings.bind("hide-timeout", "hideTimeout");
		this._settings.bind("x-align", "xAlign", this._onAppearanceChanged.bind(this));
		this._settings.bind("y-align", "yAlign", this._onAppearanceChanged.bind(this));
		this._settings.bind("text-shadow-custom", "textShadowCustom", this._onAppearanceChanged.bind(this));
		this._settings.bind("font-select", "fontSelect", this._onAppearanceChanged.bind(this));
		this._settings.bind("font-size", "fontSize", this._onAppearanceChanged.bind(this));
		this._settings.bind("font-bold", "fontBold", this._onAppearanceChanged.bind(this));
		this._settings.bind("font-italic", "fontItalic", this._onAppearanceChanged.bind(this));
		this._settings.bind("text-color", "textColor", this._onAppearanceChanged.bind(this));
		this._settings.bind("shadow-color", "shadowColor", this._onAppearanceChanged.bind(this));
		this._settings.bind("icon-size", "iconSize", this._onAppearanceChanged.bind(this));
		this._settings.bind("icon-color-custom", "iconColorCustom", this._onAppearanceChanged.bind(this));
		this._settings.bind("icon-color", "iconColor", this._onAppearanceChanged.bind(this));
		this._settings.bind("icon-shadow-color", "iconShadowColor", this._onAppearanceChanged.bind(this));
		this._settings.bind("surface-style-OSD", "surfaceStyleOSD", this._onAppearanceChanged.bind(this));
		this._settings.bind("semabe-color", "semabeColor", this._onAppearanceChanged.bind(this));
		this._settings.bind("OSD-backgd-color-custom", "osdBackgdColorCustom", this._onAppearanceChanged.bind(this));
		this._settings.bind("OSD-backgd-color1", "osdBackgdColor1", this._onAppearanceChanged.bind(this));
		this._settings.bind("OSD-backgd-color2", "osdBackgdColor2", this._onAppearanceChanged.bind(this));
		this._settings.bind("OSD-width", "OSDwidth", this._onAppearanceChanged.bind(this));
		this._settings.bind("OSD-backgd-blur", "osdBackgdBlur", this._onAppearanceChanged.bind(this));
		this._settings.bind("light-refraction", "lightRefraction", this._onAppearanceChanged.bind(this));
		this._settings.bind("OSD-border-color", "osdBorderColor", this._onAppearanceChanged.bind(this));
		this._settings.bind("OSD-border-thick", "osdBorderThick", this._onAppearanceChanged.bind(this));
		this._settings.bind("OSD-border-radius", "osdBorderRadius", this._onAppearanceChanged.bind(this));
		this._settings.bind("show-custom-controls", "showCustomControls");
		this._settings.bind("show-css-controls", "showCssControls");
		let updateDependencies = () => {
			let customBg = this._settings.getValue("OSD-backgd-color-custom");
			let customColor = this._settings.getValue("semabe-color");

			let shouldShowCustom = customBg && (customColor === "custom-color");

			let shouldShowCss = customBg && (customColor !== "custom-color");

			this._settings.setValue("show-custom-controls", shouldShowCustom);
			this._settings.setValue("show-css-controls", shouldShowCss);
		};

		this._settings.connect("changed::OSD-backgd-color-custom", updateDependencies);
		this._settings.connect("changed::semabe-color", updateDependencies);

		updateDependencies();
	}

btn_website_pressed() {
            Gio.app_info_launch_default_for_uri("https://www.opendesktop.org/p/2363741", null);
    }

	_onAppearanceChanged() {
		this._osdWindows.forEach(osd => {
			if (osd) osd.updateStyle();
		});
	}

	_layoutChanged() {
		this._osdWindows.forEach((osd) => osd.destroy());
		this._osdWindows = [];
		if (!this._osdSettings.get_boolean("show-media-keys-osd")) return;
		for (let i = 0; i < Main.layoutManager.monitors.length; i++) {
			this._osdWindows[i] = new OsdWithNumberWindow(i, this);
		}
	}

	_showOsdWindow(monitorIndex, icon, label, level) {
		if (this._osdWindows[monitorIndex]) {
			this._osdWindows[monitorIndex].setIcon(icon);
			this._osdWindows[monitorIndex].setLabel(label);
			this._osdWindows[monitorIndex].setMaxLevel(1);
			this._osdWindows[monitorIndex].setLevel(level);
			this._osdWindows[monitorIndex].show();
		}
	}

	show(monitorIndex, icon, label, level, convertIndex) {
		if (this._osdWindows.length === 0) return;
		if (monitorIndex !== -1) {
			if (convertIndex) monitorIndex = convertGdkIndex(monitorIndex);
			for (let i = 0; i < this._osdWindows.length; i++) {
				if (i === monitorIndex) this._showOsdWindow(i, icon, label, level);
				else this._osdWindows[i].cancel();
			}
		} else {
			for (let i = 0; i < this._osdWindows.length; i++) this._showOsdWindow(i, icon, label, level);
		}
	}

	hideAll() {
		this._osdWindows.forEach(osd => osd.cancel());
	}

	destroy() {
		if (this._blurRedrawId) {
			GLib.source_remove(this._blurRedrawId);
			this._blurRedrawId = 0;
		}
		if (this._monitorsChangedId) Main.layoutManager.disconnect(this._monitorsChangedId);
		if (this._osdSettingsId) this._osdSettings.disconnect(this._osdSettingsId);
		this._osdWindows.forEach((osd) => osd.destroy());
		this._settings.finalize();
	}
};

class MyExtension {
    constructor(meta) {
        this._meta = meta;
        this._manager = null;
    }
    
    enable() {
        this._manager = new CustomOsdWindowManager(this._meta);
        Main.osdWindowManager = this._manager;

        return {
            btn_website_pressed: () => {
                if (this._manager) {
                    this._manager.btn_website_pressed();
                }
            }
        };
    }
    
    disable() {
        if (this._manager) {
            this._manager.destroy();
            this._manager = null;
        }
        Main.osdWindowManager = new OsdWindowOriginal.OsdWindowManager();
    }
}

let extension = null;

function init(metadata) {
    extension = new MyExtension(metadata);
}

function enable() {
    return extension.enable();
}

function disable() {
    if (extension) extension.disable();
}
