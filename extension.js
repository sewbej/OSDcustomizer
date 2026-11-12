const UUID = "OSDcustomizer@sewbej";
const Clutter = imports.gi.Clutter;
const Gdk = imports.gi.Gdk;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const Meta = imports.gi.Meta;
const St = imports.gi.St;
const Pango = imports.gi.Pango;
const Cairo = imports.cairo;

const BarLevel = imports.ui.barLevel;
const Layout = imports.ui.layout;
const Main = imports.ui.main;
const OsdWindowOriginal = imports.ui.osdWindow;
const Settings = imports.ui.settings;

const LEVEL_ANIMATION = Clutter.AnimationMode.EASE_OUT_EXPO;
const FADE_IN_ANIMATION = Clutter.AnimationMode.EASE_OUT_QUART;
const FADE_OUT_ANIMATION = Clutter.AnimationMode.EASE_IN_QUART;

// Block fade animations of the segmented bar (duration from "level-time")
const SEGMENT_ON_ANIMATION = Clutter.AnimationMode.EASE_OUT_QUART;    // block turns on
const SEGMENT_OFF_ANIMATION = Clutter.AnimationMode.EASE_OUT_QUART;  // block turns off

// Background blur redraw interval (ms), used only when blur > 0
const BLUR_REDRAW_INTERVAL = 48;

const STYLE_NAMES = ['pane', 'tempered', 'plexi', 'oxygene'];
const COLOR_NAMES = ['azure', 'cinnamon', 'crimson', 'falcon', 'grey', 'mint', 'nordic', 'steel', 'violet'];

// Fixed corner radius (px) per predefined surface style (OSD-theme = predefined)
const PREDEFINED_RADIUS = { pane: 0, oxygene: 12, plexi: 12, tempered: 12 };

// Number of blocks in the segmented bar style
const BAR_SEGMENTS = 20;

// Circular bar geometry (Cairo angles: 0 = 3 o'clock, increasing clockwise):
// starts at 7 o'clock, ends at 5 o'clock, 300° sweep, so 50% lands at 12 o'clock.
const CIRC_START = 2 * Math.PI / 3;
const CIRC_SWEEP = 5 * Math.PI / 3;

// [schema key, property name, whether a change requires a redraw]
const BINDINGS = [
	["barlevel-custom", "barlevelCustom", true],
	["OSD-layout", "osdLayout", true],
	["barlevel-dim", "barlevelDim", true],
	["barlevel-thick", "barlevelThick", true],
	["barlevel-radius", "barlevelRadius", true],
	["barlevel-backgd-color-start", "barlevelBackgdColorStart", true],
	["barlevel-backgd-color-end", "barlevelBackgdColorEnd", true],
	["barlevel-foregd-color-start", "barlevelForegdColorStart", true],
	["barlevel-foregd-color-end", "barlevelForegdColorEnd", true],
	["barlevel-style", "barlevelStyle", true],
	["barlevel-segment-width", "barlevelSegWidth", true],
	["barlevel-segment-gap", "barlevelSegGap", true],
	["barlevel-segment-radius", "barlevelSegRadius", true],
	["level-time", "levelTime", false],
	["fade-in-time", "fadeInTime", false],
	["fade-out-time", "fadeOutTime", false],
	["hide-timeout", "hideTimeout", false],
	["x-align", "xAlign", true],
	["y-align", "yAlign", true],
	["text-shadow-custom", "textShadowCustom", true],
	["font-select", "fontSelect", true],
	["font-size", "fontSize", true],
	["font-bold", "fontBold", true],
	["font-italic", "fontItalic", true],
	["text-color", "textColor", true],
	["shadow-color", "shadowColor", true],
	["icon-size", "iconSize", true],
	["icon-color-custom", "iconColorCustom", true],
	["icon-color", "iconColor", true],
	["icon-shadow-color", "iconShadowColor", true],
	["surface-style-OSD", "surfaceStyleOSD", true],
	["OSD-theme", "osdTheme", true],
	["semabe-color", "semabeColor", true],
	["OSD-backgd-color-custom", "osdBackgdColorCustom", true],
	["OSD-backgd-color1", "osdBackgdColor1", true],
	["OSD-backgd-color2", "osdBackgdColor2", true],
	["OSD-width", "OSDwidth", true],
	["OSD-backgd-blur", "osdBackgdBlur", true],
	["light-refraction", "lightRefraction", true],
	["OSD-border-color", "osdBorderColor", true],
	["OSD-border-thick", "osdBorderThick", true],
	["OSD-border-radius", "osdBorderRadius", true],
	["show-section-bar-horizontal-continuous", "showSectionBarHorizontalContinuous", false],
	["show-section-bar-horizontal-segmented", "showSectionBarHorizontalSegmented", false],
	["show-section-bar-vertical-continuous", "showSectionBarVerticalContinuous", false],
	["show-section-bar-vertical-segmented", "showSectionBarVerticalSegmented", false],
	["show-section-bar-circular-continuous", "showSectionBarCircularContinuous", false],
	["show-section-bar-circular-segmented", "showSectionBarCircularSegmented", false],
];

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

// Applies a style only if it changed (CSS parsing is expensive)
function setStyleCached(actor, style) {
	if (actor._lastStyle === style) return;
	actor._lastStyle = style;
	actor.set_style(style);
}

const colorCache = {};
function parseColor(str) {
	if (!colorCache[str]) {
		let c = new Gdk.RGBA();
		if (!c.parse(str)) c.parse('rgba(0,0,0,0)');
		colorCache[str] = [c.red, c.green, c.blue, c.alpha];
	}
	return colorCache[str];
}

function easeOutExpo(t) {
	return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

// Moves an actor to a new parent (index < 0 = append)
function moveActor(actor, parent, index = -1) {
	let old = actor.get_parent();
	if (old === parent && index < 0) return;
	if (old) old.remove_child(actor);
	if (index >= 0) parent.insert_child_at_index(actor, index);
	else parent.add_child(actor);
}

// Paint source for the circular bar: radial gradient across the ring thickness
// (first color at the outer edge, second at the inner edge; dial coordinates)
function setGradientSource(cr, g, c1, c0) {
	let grad = new Cairo.RadialGradient(g.cx, g.cy, g.ri, g.cx, g.cy, g.ro);
	grad.addColorStopRGBA(0, ...c0);
	grad.addColorStopRGBA(1, ...c1);
	cr.setSource(grad);
}

// Integer bounding box of a ring sector (1 px margin for antialiasing)
function sectorBounds(cx, cy, ri, ro, a0, a1) {
	let xs = [], ys = [];
	let add = (r, a) => { xs.push(cx + r * Math.cos(a)); ys.push(cy + r * Math.sin(a)); };
	add(ri, a0); add(ri, a1); add(ro, a0); add(ro, a1);
	for (let k = Math.ceil(a0 / (Math.PI / 2)); k * Math.PI / 2 <= a1; k++)
		add(ro, k * Math.PI / 2);
	let x = Math.floor(Math.min(...xs)) - 1;
	let y = Math.floor(Math.min(...ys)) - 1;
	return {
		x, y,
		w: Math.max(1, Math.ceil(Math.max(...xs)) + 1 - x),
		h: Math.max(1, Math.ceil(Math.max(...ys)) + 1 - y),
	};
}

// Ring sector path (a0..a1, ri..ro) with rounded corners of the given radius.
// Returns false if the sector is empty.
function addSectorPath(cr, cx, cy, ri, ro, a0, a1, radius) {
	let delta = a1 - a0;
	if (!(delta > 0) || !(ro > ri)) return false;

	let s = Math.sin(Math.min(delta, Math.PI) / 2);
	// Factor 0.98: with c exactly at the limit, a0+d and a1-d almost touch and rounding error
	// could swap their order, making Cairo draw a full circle (center flicker)
	let c = 0.98 * Math.min(radius, (ro - ri) / 2, ro * s / (1 + s), ri * s / Math.max(1 - s, 1e-6));
	if (!(c > 0.25)) {
		cr.arc(cx, cy, ro, a0, a1);
		cr.arcNegative(cx, cy, ri, a1, a0);
		cr.closePath();
		return true;
	}

	let dO = Math.asin(c / (ro - c));
	let dI = Math.asin(c / (ri + c));
	let at = (r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
	let p;

	cr.arc(cx, cy, ro, a0 + dO, a1 - dO);
	p = at(ro - c, a1 - dO);
	cr.arc(p[0], p[1], c, a1 - dO, a1 + Math.PI / 2);
	p = at(ri + c, a1 - dI);
	cr.arc(p[0], p[1], c, a1 + Math.PI / 2, a1 - dI + Math.PI);
	cr.arcNegative(cx, cy, ri, a1 - dI, a0 + dI);
	p = at(ri + c, a0 + dI);
	cr.arc(p[0], p[1], c, a0 + dI + Math.PI, a0 + 1.5 * Math.PI);
	p = at(ro - c, a0 + dO);
	cr.arc(p[0], p[1], c, a0 - Math.PI / 2, a0 + dO);
	cr.closePath();
	return true;
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

			this._icon = new St.Icon({ y_expand: true });
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

			this._customBarBg = new St.Bin({ important: true });
			this._customBarFill = new St.Widget({ important: true });
			this._customBarBg.set_child(this._customBarFill);
			this._vbox.add_child(this._customBarBg);

			// Keep the fill's fixed edge in place after every allocation (see _anchorBarFill)
			this._customBarFill.connect('notify::allocation', () => this._anchorBarFill());

			// Segmented style: BAR_SEGMENTS separate blocks. Index 0 is the lowest level
			// (leftmost horizontally, bottom vertically). Sizes and colors are set in _updateSegments.
			this._segBox = new St.BoxLayout({
				x_align: Clutter.ActorAlign.CENTER,
				y_align: Clutter.ActorAlign.CENTER,
			});
			// A block is a container (size + margin forming the gap) with two layers:
			// "track" (off color) and "lit" (on color). A state change cross-fades their opacity,
			// so resting colors stay exact.
			this._segments = [];
			this._segTracks = [];
			this._segLits = [];
			for (let i = 0; i < BAR_SEGMENTS; i++) {
				let seg = new St.Widget({ layout_manager: new Clutter.BinLayout(), important: true });
				let track = new St.Widget({ important: true });
				let lit = new St.Widget({ important: true });
				lit.opacity = 0;
				seg.add_child(track);
				seg.add_child(lit);
				this._segments.push(seg);
				this._segTracks.push(track);
				this._segLits.push(lit);
			}
			this._segOn = new Array(BAR_SEGMENTS).fill(null);
			this._segMargins = [];
			this._segRadius = 0;
			this._segLit = 0;
			this._segLayoutKey = null;
			this._vbox.add_child(this._segBox);
			this._segBox.hide();

			// Circular bar: a "dial" with manually placed children (ring, blocks,
			// center text, icon), drawn with Cairo (St.DrawingArea).
			this._dial = new St.Widget({ layout_manager: new Clutter.FixedLayout(), important: true });
			this._circArc = new St.DrawingArea();
			this._circArc.connect('repaint', area => this._paintArc(area));
			this._circArc.hide();
			this._dial.add_child(this._circArc);
			this._circTracks = [];
			this._circLits = [];
			for (let i = 0; i < BAR_SEGMENTS; i++) {
				let track = new St.DrawingArea();
				let lit = new St.DrawingArea();
				track.connect('repaint', area => this._paintBlock(area));
				lit.connect('repaint', area => this._paintBlock(area));
				lit.opacity = 0;
				track.hide();
				lit.hide();
				this._dial.add_child(track);
				this._dial.add_child(lit);
				this._circTracks.push(track);
				this._circLits.push(lit);
			}
			this._circOn = new Array(BAR_SEGMENTS).fill(null);
			this._circCenter = new St.BoxLayout({ vertical: true });
			this._dial.add_child(this._circCenter);
			this._circGeom = null;
			this._circValue = 0;
			this._circAnimId = 0;

			this._hideTimeoutId = 0;
			this._blurRedrawId = 0;
			this._hiding = false;
			this._unredirectDisabled = false;
			this._level = 0;
			this._dirty = true;
			this._layoutKey = null;
			this._styleClass = null;

			// Position depends on the actual hbox size; re-correct it whenever the size changes.
			// Only translation is set, so there is no allocation loop.
			this._hbox.connect('notify::allocation', () => this._updatePosition());

			this.updateStyle();
			this._reset();
			Main.uiGroup.add_child(this);
		}

		markDirty() {
			this._dirty = true;
		}

		updateStyle() {
			this._dirty = false;
			this._updateLayout();
			this._updateBackground();
			this._updateBar();
			this._updateText();
			this._updateIcon();
			this._updatePosition();
		}

		get _isVertical() {
			return this._manager.osdLayout === "vertical" && this._manager.barlevelCustom;
		}

		// Gradient direction across the bar thickness:
		//   horizontal -> vertical, vertical -> horizontal, circular -> vertical
		get _gradientDirection() {
			let map = { horizontal: 'vertical', vertical: 'horizontal', circular: 'vertical' };
			return map[this._manager.osdLayout] ?? 'vertical';
		}

		get _isCircular() {
			return this._manager.osdLayout === "circular" && this._manager.barlevelCustom;
		}

		// Rebuild children only when the layout changes (horizontal / vertical / circular)
		_updateLayout() {
			let isCircular = this._isCircular;
			let isVertical = this._isVertical;
			let key = isCircular ? 'c' : (isVertical ? 'v' : 'h');
			if (this._layoutKey === key) return;
			this._layoutKey = key;

			this._hbox.remove_all_children();

			// In the circular layout the text is centered on the dial
			let align = isCircular ? Clutter.ActorAlign.CENTER : Clutter.ActorAlign.FILL;
			this._label.set_x_align(align);
			this._label.set_y_align(align);
			this._label.set_x_expand(isCircular);
			this._label.set_y_expand(isCircular);
			this._percentage.set_x_expand(isCircular);
			this._percentage.set_y_expand(isCircular);

			if (isCircular) {
				moveActor(this._label, this._circCenter);
				moveActor(this._percentage, this._circCenter);
				moveActor(this._icon, this._dial);
				this._hbox.add_child(this._dial);
				this._hbox.vertical = false;
				return;
			}

			moveActor(this._label, this._vbox, 0);
			this._icon.set_size(-1, -1);
			if (isVertical) {
				moveActor(this._percentage, this._hbox);
				this._hbox.add_child(this._vbox);
				moveActor(this._icon, this._hbox);
			} else {
				moveActor(this._icon, this._hbox);
				this._hbox.add_child(this._vbox);
				moveActor(this._percentage, this._hbox);
			}
			this._hbox.vertical = isVertical;
			this._vbox.vertical = !isVertical;
		}

		_updateBackground() {
			let m = this._manager;

			// Style class - always remove the previous one
			if (this._styleClass) {
				this._hbox.remove_style_class_name(this._styleClass);
				this._styleClass = null;
			}

			if (!m.osdBackgdColorCustom) {
				setStyleCached(this._hbox, null);
				return;
			}

			// OSD-theme:
			//   customOSD  - custom colors (gradient + border) from settings
			//   predefined - ready-made color scheme + surface style from CSS
			//   disabled   - colors from the current theme (only padding, blur, refraction, radius)
			let theme = m.osdTheme;
			let isCustomTheme = (theme === 'customOSD');

			if (theme === 'predefined') {
				let surface = m.surfaceStyleOSD;
				let color = m.semabeColor ? m.semabeColor.toLowerCase() : '';
				if (STYLE_NAMES.includes(surface) && COLOR_NAMES.includes(color)) {
					this._styleClass = `osd-style-${surface}-${color}`;
					this._hbox.add_style_class_name(this._styleClass);
				}
			}

			let padding = `${m.OSDwidth}px`;

			// Corner radius by mode:
			//   customOSD  - slider value
			//   predefined - fixed value for the chosen surface style
			//   disabled   - not set (radius comes from the current theme)
			let radiusRule = '';
			if (isCustomTheme)
				radiusRule = `border-radius: ${m.osdBorderRadius}px;`;
			else if (theme === 'predefined' && Object.prototype.hasOwnProperty.call(PREDEFINED_RADIUS, m.surfaceStyleOSD))
				radiusRule = `border-radius: ${PREDEFINED_RADIUS[m.surfaceStyleOSD]}px;`;

			let bumpmap = m.lightRefraction === 'none'
				? 'none'
				: `url("${m.extensionPath}/refraction/${m.lightRefraction}")`;

			let style = `
				padding: ${padding};
				background-blur: ${m.osdBackgdBlur}px;
				background-bumpmap: ${bumpmap};
				${radiusRule}
			`;

			if (isCustomTheme) {
				style += `
					box-shadow: none;
					background-color: ${m.osdBackgdColor1};
					background-gradient-direction: vertical;
					background-gradient-start: ${m.osdBackgdColor1};
					background-gradient-end: ${m.osdBackgdColor2};
					border: ${m.osdBorderThick}px solid ${m.osdBorderColor};
				`;
			}

			setStyleCached(this._hbox, style);
		}

		_updateBar() {
			let m = this._manager;

			if (!this._isCircular) this._stopCircAnim(false);

			if (!m.barlevelCustom) {
				this._systemLevel.show();
				this._customBarBg.hide();
				this._segBox.hide();
				this._customBarFill.translation_x = 0;
				this._customBarFill.translation_y = 0;
				return;
			}

			this._systemLevel.hide();

			if (this._isCircular) {
				this._customBarFill.remove_all_transitions();
				this._customBarBg.hide();
				this._segBox.hide();
				this._updateCircular();
				return;
			}

			if (m.barlevelStyle === 'segmented') {
				this._customBarFill.remove_all_transitions();
				this._customBarBg.hide();
				this._segBox.show();
				this._updateSegments();
				return;
			}

			this._segBox.hide();
			this._customBarBg.show();

			let radius = `border-radius: ${m.barlevelRadius}px;`;
			setStyleCached(this._customBarBg, `background-gradient-direction: ${this._gradientDirection}; background-gradient-start: ${m.barlevelBackgdColorStart}; background-gradient-end: ${m.barlevelBackgdColorEnd}; ${radius}`);
			setStyleCached(this._customBarFill, `background-gradient-direction: ${this._gradientDirection}; background-gradient-start: ${m.barlevelForegdColorStart}; background-gradient-end: ${m.barlevelForegdColorEnd}; ${radius}`);

			let isVertical = this._isVertical;
			let maxDim = m.barlevelDim;
			let thick = m.barlevelThick;
			let targetSize = this._barSize();

			this._customBarFill.remove_all_transitions();
			if (isVertical) {
				this._customBarBg.set_size(thick, maxDim);
				this._customBarFill.width = thick;
				this._customBarFill.height = targetSize;
			} else {
				this._customBarBg.set_size(maxDim, thick);
				this._customBarFill.height = thick;
				this._customBarFill.width = targetSize;
			}
			this._anchorBarFill();
		}

		// Keeps the fixed edge (left horizontally, bottom vertically) exactly in place. The Bin centers
		// the fill and allocation is rounded to pixels, so translation is recomputed from the real
		// allocation after every change instead of being animated separately (which made the edge jitter).
		_anchorBarFill() {
			if (!this._manager.barlevelCustom || this._manager.barlevelStyle === 'segmented' || this._isCircular) return;

			let fill = this._customBarFill;
			let box = fill.get_allocation_box();
			let tx = 0;
			let ty = 0;
			if (this._isVertical) {
				let bgBox = this._customBarBg.get_allocation_box();
				ty = (bgBox.y2 - bgBox.y1) - box.y2;
			} else {
				tx = -box.x1;
			}
			if (fill.translation_x !== tx) fill.translation_x = tx;
			if (fill.translation_y !== ty) fill.translation_y = ty;
		}

		// Fill length; above 100% volume it stays within the bar background
		_barSize() {
			let fraction = Math.min(Math.max(this._level / 100, 0), 1);
			return Math.round(fraction * this._manager.barlevelDim);
		}

		// Number of lit blocks, rounded down: 30% -> 6, 59% -> 11, 100% -> 20
		_litSegments() {
			let level = Math.min(Math.max(this._level, 0), 100);
			return Math.floor(level * BAR_SEGMENTS / 100 + 1e-9);
		}

		// Segmented style: sizes, gaps, radii and block order.
		// On level change only the lit state is updated (_applySegmentLevel).
		_updateSegments() {
			let m = this._manager;
			let isVertical = this._isVertical;
			let along = m.barlevelSegWidth;   // block size along the bar
			let across = m.barlevelThick;	 // block size across the bar
			let gap = m.barlevelSegGap;

			// Horizontally blocks go left to right (0..19). Vertically the first child is on top,
			// so they are added in reverse (19..0) and the bar fills from the bottom.
			let key = isVertical ? 'v' : 'h';
			if (this._segLayoutKey !== key) {
				this._segLayoutKey = key;
				this._segBox.remove_all_children();
				let order = isVertical ? this._segments.slice().reverse() : this._segments;
				order.forEach(seg => this._segBox.add_child(seg));
				this._segBox.vertical = isVertical;
			}

			this._segRadius = Math.min(m.barlevelSegRadius, Math.floor(Math.min(along, across) / 2));
			for (let i = 0; i < BAR_SEGMENTS; i++) {
				// Gap after every block except the last one in display order
				let isLast = isVertical ? i === 0 : i === BAR_SEGMENTS - 1;
				this._segMargins[i] = isLast ? '0' : (isVertical ? `0 0 ${gap}px 0` : `0 ${gap}px 0 0`);
				let sw = isVertical ? across : along;
				let sh = isVertical ? along : across;
				this._segments[i].set_size(sw, sh);
				this._segTracks[i].set_size(sw, sh);
				this._segLits[i].set_size(sw, sh);
			}

			this._applySegmentStyles();

			// Full refresh (start, settings change): set the state immediately, without animation
			this._segLit = this._litSegments();
			this._applySegmentLevel(false);
		}

		_applySegmentStyles() {
			if (this._segMargins.length === 0) return;
			let m = this._manager;
			let shape = `border-radius: ${this._segRadius}px;`;
			for (let i = 0; i < BAR_SEGMENTS; i++) {
				setStyleCached(this._segments[i], `margin: ${this._segMargins[i]};`);
				setStyleCached(this._segTracks[i], `background-gradient-direction: ${this._gradientDirection}; background-gradient-start: ${m.barlevelBackgdColorStart}; background-gradient-end: ${m.barlevelBackgdColorEnd}; ${shape}`);
				setStyleCached(this._segLits[i], `background-gradient-direction: ${this._gradientDirection}; background-gradient-start: ${m.barlevelForegdColorStart}; background-gradient-end: ${m.barlevelForegdColorEnd};${shape}`);
			}
		}

		// Lit block: "lit" layer visible, "track" hidden (off is the reverse).
		// animate = true: only blocks that change state cross-fade (duration from "level-time").
		// animate = false: all blocks are set immediately.
		_applySegmentLevel(animate) {
			if (this._isCircular)
				this._fadeBlocks(this._circTracks, this._circLits, this._circOn, animate);
			else
				this._fadeBlocks(this._segTracks, this._segLits, this._segOn, animate);
		}

		_fadeBlocks(tracks, lits, states, animate) {
			let duration = this._manager.levelTime;
			for (let i = 0; i < BAR_SEGMENTS; i++) {
				let on = i < this._segLit;
				if (animate && states[i] === on) continue;
				states[i] = on;

				let track = tracks[i];
				let lit = lits[i];
				let trackOpacity = on ? 0 : 255;
				let litOpacity = on ? 255 : 0;
				if (animate) {
					let mode = on ? SEGMENT_ON_ANIMATION : SEGMENT_OFF_ANIMATION;
					track.ease({ opacity: trackOpacity, duration, mode });
					lit.ease({ opacity: litOpacity, duration, mode });
				} else {
					track.remove_all_transitions();
					lit.remove_all_transitions();
					track.opacity = trackOpacity;
					lit.opacity = litOpacity;
				}
			}
		}

		// Level 0..1 for the continuous circular bar
		_circTarget() {
			return Math.min(Math.max(this._level, 0), 100) / 100;
		}

		// Circular bar: dial geometry and child positions.
		// Bar length (barlevel-dim, or blocks + gaps) is the arc length along the ring centerline;
		// barlevel-thick is the ring thickness. The icon sits at 6 o'clock.
		_updateCircular() {
			let m = this._manager;
			let segmented = m.barlevelStyle === 'segmented';
			let iconPx = Math.round(32 * (m.iconSize / 100));
			let thick = Math.max(m.barlevelThick, 1);
			let length = segmented
				? BAR_SEGMENTS * m.barlevelSegWidth + (BAR_SEGMENTS - 1) * m.barlevelSegGap
				: m.barlevelDim;

			let R = Math.max(length, 1) / CIRC_SWEEP;
			let ro = R + thick / 2;
			let ri = Math.max(R - thick / 2, 1);
			let W = Math.ceil(Math.max(2 * ro, iconPx));
			let cx = W / 2;
			let cy = ro;
			let H = Math.ceil(Math.max(cy + ro * Math.cos(Math.PI / 6), cy + R + iconPx / 2));

			this._dial.set_size(W, H);
			this._circGeom = { cx, cy, R, ri, ro, radius: m.barlevelRadius };

			let side = Math.max(Math.round(2 * ri), 1);
			this._circCenter.set_position(Math.round(cx - side / 2), Math.round(cy - side / 2));
			this._circCenter.set_size(side, side);

			this._icon.set_size(iconPx, iconPx);
			this._icon.set_position(Math.round(cx - iconPx / 2), Math.round(cy + R - iconPx / 2));

			let bg = [parseColor(m.barlevelBackgdColorStart), parseColor(m.barlevelBackgdColorEnd)];
			let fg = [parseColor(m.barlevelForegdColorStart), parseColor(m.barlevelForegdColorEnd)];

			if (!segmented) {
				this._circTracks.concat(this._circLits).forEach(a => a.hide());
				this._circArc.set_position(0, 0);
				this._circArc.set_size(W, H);
				this._circArc.show();
				this._stopCircAnim(false);
				this._circValue = this._circTarget();
				this._circArc.queue_repaint();
				return;
			}

			this._circArc.hide();
			let w = m.barlevelSegWidth;
			let gap = m.barlevelSegGap;
			let radius = Math.min(m.barlevelSegRadius, Math.floor(Math.min(w, thick) / 2));
			for (let i = 0; i < BAR_SEGMENTS; i++) {
				let a0 = CIRC_START + i * (w + gap) / R;
				let a1 = a0 + w / R;
				let b = sectorBounds(cx, cy, ri, ro, a0, a1);
				[[this._circTracks[i], bg], [this._circLits[i], fg]].forEach(([area, color]) => {
					area._paint = { color: color[0], colorEnd: color[1], radius, a0, a1, bx: b.x, by: b.y };
					area.set_position(b.x, b.y);
					area.set_size(b.w, b.h);
					area.show();
					area.queue_repaint();
				});
			}

			this._segLit = this._litSegments();
			this._applySegmentLevel(false);
		}

		// Smooth level change of the continuous circular bar (same curve as EASE_OUT_EXPO)
		_animateCircular(target) {
			this._stopCircAnim(false);
			let duration = this._manager.levelTime;
			if (!(duration > 0) || Math.abs(target - this._circValue) < 1e-4) {
				this._circValue = target;
				this._circArc.queue_repaint();
				return;
			}
			let from = this._circValue;
			let t0 = GLib.get_monotonic_time();
			this._circAnimId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
				let t = (GLib.get_monotonic_time() - t0) / 1000 / duration;
				this._circValue = t >= 1 ? target : from + (target - from) * easeOutExpo(t);
				this._circArc.queue_repaint();
				if (t >= 1) {
					this._circAnimId = 0;
					return GLib.SOURCE_REMOVE;
				}
				return GLib.SOURCE_CONTINUE;
			});
		}

		_stopCircAnim(finish) {
			if (this._circAnimId) {
				GLib.source_remove(this._circAnimId);
				this._circAnimId = 0;
			}
			if (finish) {
				this._circValue = this._circTarget();
				this._circArc.queue_repaint();
			}
		}

		_paintArc(area) {
			let g = this._circGeom;
			let m = this._manager;
			let cr = area.get_context();
			cr.setOperator(Cairo.Operator.CLEAR);
			cr.paint();
			cr.setOperator(Cairo.Operator.OVER);
			if (g) {
				let a1 = CIRC_START + CIRC_SWEEP;
				if (addSectorPath(cr, g.cx, g.cy, g.ri, g.ro, CIRC_START, a1, g.radius)) {
					setGradientSource(cr, g, parseColor(m.barlevelBackgdColorStart), parseColor(m.barlevelBackgdColorEnd));
					cr.fill();
				}
				let sweep = Math.min(Math.max(this._circValue, 0), 1) * CIRC_SWEEP;
				if (sweep * g.R >= 0.5 &&
					addSectorPath(cr, g.cx, g.cy, g.ri, g.ro, CIRC_START, CIRC_START + sweep, g.radius)) {
					setGradientSource(cr, g, parseColor(m.barlevelForegdColorStart), parseColor(m.barlevelForegdColorEnd));
					cr.fill();
				}
			}
			cr.$dispose();
		}

		_paintBlock(area) {
			let g = this._circGeom;
			let p = area._paint;
			let cr = area.get_context();
			cr.setOperator(Cairo.Operator.CLEAR);
			cr.paint();
			cr.setOperator(Cairo.Operator.OVER);
			if (g && p) {
				cr.translate(-p.bx, -p.by);
				if (addSectorPath(cr, g.cx, g.cy, g.ri, g.ro, p.a0, p.a1, p.radius)) {
					setGradientSource(cr, g, p.color, p.colorEnd);
					cr.fill();
				}
			}
			cr.$dispose();
		}

		_updateText() {
			let m = this._manager;
			let fontDesc = Pango.FontDescription.from_string(m.fontSelect);
			let fontFamily = fontDesc.get_family();
			let fontWeight = m.fontBold ? 'bold' : 'normal';
			let fontStyle = m.fontItalic ? 'italic' : 'normal';
			let style = `font-family: '${fontFamily}'; font-size: ${m.fontSize}%; font-weight: ${fontWeight}; font-style: ${fontStyle}; margin: 0;`;
			if (m.textShadowCustom)
				style += ` color: ${m.textColor}; text-shadow: ${m.shadowColor} 1px 1.6px 1.1px 0px;`;
			setStyleCached(this._percentage, style);
		}

		_updateIcon() {
			let m = this._manager;
			let size = Math.round(32 * (m.iconSize / 100));
			let style = `icon-size: ${size}px; margin: 0;`;
			if (m.iconColorCustom)
				style += ` color: ${m.iconColor}; icon-shadow: ${m.iconShadowColor} 1px 1.6px 1.1px 0px;`;
			setStyleCached(this._icon, style);
		}

		// Position is computed from the preferred hbox size (the current allocation is stale for a
		// hidden actor), so the window does not jump and no extension reload is needed.
		_updatePosition() {
			let monitor = Main.layoutManager.monitors[this._monitorIndex];
			if (!monitor) return;

			let [, , natW, natH] = this._hbox.get_preferred_size();
			if (natW <= 0 || natH <= 0) return;

			let x = Math.round((monitor.width - natW) * (this._manager.xAlign / 100));
			let y = Math.round((monitor.height - natH) * (this._manager.yAlign / 100));

			if (this._hbox.translation_x !== x) this._hbox.translation_x = x;
			if (this._hbox.translation_y !== y) this._hbox.translation_y = y;
		}

		setLevel(value) {
			if (value === null || value === undefined) return;

			this._level = value;
			let m = this._manager;

			if (m.barlevelCustom && m.barlevelStyle === 'segmented') {
				// Segmented style: blocks fade in and out
				if (this._dirty) this.updateStyle();
				this._segLit = this._litSegments();
				this._applySegmentLevel(true);
			} else if (m.barlevelCustom && this._isCircular) {
				if (this._dirty) this.updateStyle();
				this._animateCircular(this._circTarget());
			} else if (m.barlevelCustom) {
				let targetSize = this._barSize();
				if (this._isVertical) {
					this._customBarFill.width = m.barlevelThick;
					this._customBarFill.ease({
						height: targetSize,
						duration: m.levelTime,
						mode: LEVEL_ANIMATION
					});
				} else {
					this._customBarFill.height = m.barlevelThick;
					this._customBarFill.ease({
						width: targetSize,
						duration: m.levelTime,
						mode: LEVEL_ANIMATION
					});
				}
			} else {
				this._systemLevel.ease_property('value', value / 100, {
					mode: LEVEL_ANIMATION,
					duration: m.levelTime
				});
			}
			this._percentage.set_text(value.toString());
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

			if (this._dirty) this.updateStyle();

			if (!this.visible) {
				if (!this._unredirectDisabled) {
					Meta.disable_unredirect_for_display(global.display);
					this._unredirectDisabled = true;
				}
				super.show();
				this.opacity = 0;
				this._updatePosition();
				this.get_parent().set_child_above_sibling(this, null);
				this.ease({
					opacity: 255,
					duration: this._manager.fadeInTime,
					mode: FADE_IN_ANIMATION,
				});
			} else if (this._hiding || this.opacity < 255) {
				// Shown again while fading out - resume from the current opacity
				this._hiding = false;
				this.remove_all_transitions();
				this.ease({
					opacity: 255,
					duration: this._manager.fadeInTime,
					mode: FADE_IN_ANIMATION,
				});
			}

			this._startBlurRedraw();

			if (this._hideTimeoutId) GLib.source_remove(this._hideTimeoutId);
			this._hideTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._manager.hideTimeout, this._hide.bind(this));
		}

		// Background blur needs manual redraws; started only when blur > 0
		_startBlurRedraw() {
			if (this._blurRedrawId || !(this._manager.osdBackgdBlur > 0)) return;
			this._blurRedrawId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, BLUR_REDRAW_INTERVAL, () => {
				this._hbox.queue_redraw();
				return GLib.SOURCE_CONTINUE;
			});
		}

		_stopBlurRedraw() {
			if (!this._blurRedrawId) return;
			GLib.source_remove(this._blurRedrawId);
			this._blurRedrawId = 0;
		}

		cancel() {
			if (!this._hideTimeoutId) return;
			GLib.source_remove(this._hideTimeoutId);
			this._hide();
		}

		_hide() {
			this._hideTimeoutId = 0;
			this._hiding = true;
			this.ease({
				opacity: 0,
				duration: this._manager.fadeOutTime,
				mode: FADE_OUT_ANIMATION,
				onComplete: () => {
					// The window may have been shown again in the meantime
					if (!this._hiding) return;
					this._hiding = false;
					this._reset();
				},
			});
			return GLib.SOURCE_REMOVE;
		}

		_enableUnredirect() {
			if (!this._unredirectDisabled) return;
			this._unredirectDisabled = false;
			Meta.enable_unredirect_for_display(global.display);
		}

		_reset() {
			this._stopCircAnim(true);
			this._stopBlurRedraw();
			this._enableUnredirect();
			super.hide();
			this.setLabel(null);
			this.setMaxLevel(null);
		}

		destroy() {
			if (this._hideTimeoutId) {
				GLib.source_remove(this._hideTimeoutId);
				this._hideTimeoutId = 0;
			}
			this._stopBlurRedraw();
			this._enableUnredirect();
			this.remove_all_transitions();
			this._customBarFill.remove_all_transitions();
			this._stopCircAnim(false);
			// Actors detached from hbox (depending on the layout) are not destroyed by the cascade
			for (let a of [this._dial, this._vbox])
				if (!a.get_parent()) a.destroy();
			super.destroy();
		}
	});
}

const OsdWithNumberWindow = global.OsdWithNumberWindowCustom;

var CustomOsdWindowManager = class {
	constructor(metadata) {
		this.extensionPath = metadata.path;
		this._osdWindows = [];
		this._redrawIdleId = 0;
		this._settings = new Settings.ExtensionSettings(this, metadata.uuid);
		this._bindSettings();
		this._monitorsChangedId = Main.layoutManager.connect('monitors-changed', this._layoutChanged.bind(this));
		this._osdSettings = new Gio.Settings({ schema_id: "org.cinnamon" });
		this._osdSettingsId = this._osdSettings.connect("changed::show-media-keys-osd", this._layoutChanged.bind(this));
		this._layoutChanged();
	}

	_bindSettings() {
		let onChanged = this._onAppearanceChanged.bind(this);
		for (let [key, prop, redraw] of BINDINGS) {
			if (redraw)
				this._settings.bind(key, prop, onChanged);
			else
				this._settings.bind(key, prop);
		}
		let updateDependencies = () => {
			let customLayout = this._settings.getValue("OSD-layout");
			let customStyle = this._settings.getValue("barlevel-style");

			let shouldShowCustomHorizontalContinuous = (customLayout === "horizontal") && (customStyle === "continuous");
			let shouldShowCustomHorizontalSegmented = (customLayout === "horizontal") && (customStyle === "segmented");
			let shouldShowCustomVerticalContinuous = (customLayout === "vertical") && (customStyle === "continuous");
			let shouldShowCustomVerticalSegmented = (customLayout === "vertical") && (customStyle === "segmented");
			let shouldShowCustomCircularContinuous = (customLayout === "circular") && (customStyle === "continuous");
			let shouldShowCustomCircularSegmented = (customLayout === "circular") && (customStyle === "segmented");

			this._settings.setValue("show-section-bar-horizontal-continuous", shouldShowCustomHorizontalContinuous);
			this._settings.setValue("show-section-bar-horizontal-segmented", shouldShowCustomHorizontalSegmented);
			this._settings.setValue("show-section-bar-vertical-continuous", shouldShowCustomVerticalContinuous);
			this._settings.setValue("show-section-bar-vertical-segmented", shouldShowCustomVerticalSegmented);
			this._settings.setValue("show-section-bar-circular-continuous", shouldShowCustomCircularContinuous);
			this._settings.setValue("show-section-bar-circular-segmented", shouldShowCustomCircularSegmented);
		};

		this._settings.connect("changed::OSD-layout", updateDependencies);
		this._settings.connect("changed::barlevel-style", updateDependencies);

		updateDependencies();
	}

	btn_website_pressed() {
		Gio.app_info_launch_default_for_uri("https://www.opendesktop.org/p/2363741", null);
	}

	btn_issue_pressed() {
		Gio.app_info_launch_default_for_uri("https://github.com/sewbej/floating-panels/issues", null);
	}

	btn_donate_pressed() {
		Gio.app_info_launch_default_for_uri("https://ko-fi.com/sewbej", null);
	}

	// Windows are marked dirty; visible ones are refreshed once (debounced),
	// the rest refresh on the next show().
	_onAppearanceChanged() {
		this._osdWindows.forEach(osd => osd && osd.markDirty());
		if (this._redrawIdleId) return;
		this._redrawIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
			this._redrawIdleId = 0;
			this._osdWindows.forEach(osd => {
				if (osd && osd.visible) osd.updateStyle();
			});
			return GLib.SOURCE_REMOVE;
		});
	}

	_layoutChanged() {
		this._osdWindows.forEach((osd) => osd.destroy());
		this._osdWindows = [];
		if (!this._osdSettings.get_boolean("show-media-keys-osd")) return;
		for (let i = 0; i < Main.layoutManager.monitors.length; i++)
			this._osdWindows[i] = new OsdWithNumberWindow(i, this);
	}

	_showOsdWindow(monitorIndex, icon, label, level) {
		let osd = this._osdWindows[monitorIndex];
		if (!osd) return;
		osd.setIcon(icon);
		osd.setLabel(label);
		osd.setMaxLevel(1);
		osd.setLevel(level);
		osd.show();
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
			for (let i = 0; i < this._osdWindows.length; i++)
				this._showOsdWindow(i, icon, label, level);
		}
	}

	hideAll() {
		this._osdWindows.forEach(osd => osd.cancel());
	}

	destroy() {
		if (this._redrawIdleId) {
			GLib.source_remove(this._redrawIdleId);
			this._redrawIdleId = 0;
		}
		if (this._monitorsChangedId) Main.layoutManager.disconnect(this._monitorsChangedId);
		if (this._osdSettingsId) this._osdSettings.disconnect(this._osdSettingsId);
		this._osdWindows.forEach((osd) => osd.destroy());
		this._osdWindows = [];
		this._settings.finalize();
	}
};

class MyExtension {
	constructor(meta) {
		this._meta = meta;
		this._manager = null;
		this._origManager = null;
	}

	enable() {
		this._origManager = Main.osdWindowManager;
		this._manager = new CustomOsdWindowManager(this._meta);
		Main.osdWindowManager = this._manager;

		// All button callbacks must be in one object -
		// anything after the first "return" would never run.
		return {
			btn_website_pressed: () => {
				if (this._manager) this._manager.btn_website_pressed();
			},
			btn_issue_pressed: () => {
				if (this._manager) this._manager.btn_issue_pressed();
			},
			btn_donate_pressed: () => {
				if (this._manager) this._manager.btn_donate_pressed();
			}
		};
	}

	disable() {
		if (this._manager) {
			this._manager.destroy();
			this._manager = null;
		}
		// Restore the original manager instead of creating a new one (avoids leaking windows)
		if (this._origManager) {
			Main.osdWindowManager = this._origManager;
			this._origManager = null;
		} else {
			Main.osdWindowManager = new OsdWindowOriginal.OsdWindowManager();
		}
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
