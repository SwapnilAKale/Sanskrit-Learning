'use strict';
// Status badge that follows the mouse pointer. A layered popup that is click-through
// (WS_EX_TRANSPARENT), never activated (WS_EX_NOACTIVATE, shown with SW_SHOWNOACTIVATE and
// SWP_NOACTIVATE), has no taskbar entry (WS_EX_TOOLWINDOW) and stays topmost. The system cursor
// is never changed. It lives on the tray worker thread and is driven by tick().
const k = require('koffi');
const u = k.load('user32.dll'), g = k.load('gdi32.dll'), kernel = k.load('kernel32.dll');
const point = k.struct({x:'int32', y:'int32'});
const size = k.struct({cx:'int32', cy:'int32'});
const blend = k.struct({op:'uint8', flags:'uint8', alpha:'uint8', format:'uint8'});
const bitmapInfo = k.struct({size:'uint32', width:'int32', height:'int32', planes:'uint16', bits:'uint16', compression:'uint32', imageSize:'uint32', xppm:'int32', yppm:'int32', used:'uint32', important:'uint32', colors:'uint32'});
const windowClass = k.struct({size:'uint32', style:'uint32', proc:'void *', classExtra:'int32', windowExtra:'int32', instance:'void *', icon:'void *', cursor:'void *', background:'void *', menu:'str16', name:'str16', smallIcon:'void *'});
const fn = {
 register:u.func('__stdcall','RegisterClassExW','uint16',[k.pointer(windowClass)]),
 unregister:u.func('int __stdcall UnregisterClassW(str16 name, void *instance)'),
 create:u.func('void * __stdcall CreateWindowExW(uint32 ex, str16 cls, str16 name, uint32 style, int x, int y, int w, int h, void *parent, void *menu, void *instance, void *param)'),
 destroy:u.func('int __stdcall DestroyWindow(void *window)'),
 show:u.func('int __stdcall ShowWindow(void *window, int command)'),
 position:u.func('int __stdcall SetWindowPos(void *window, intptr_t after, int x, int y, int w, int h, uint32 flags)'),
 update:u.func('__stdcall','UpdateLayeredWindow','int',['void *','void *',k.pointer(point),k.pointer(size),'void *',k.pointer(point),'uint32',k.pointer(blend),'uint32']),
 cursor:u.func('__stdcall','GetCursorPos','int',[k.out(k.pointer(point))]),
 metric:u.func('int __stdcall GetSystemMetrics(int index)'),
 getDC:u.func('void * __stdcall GetDC(void *window)'),
 releaseDC:u.func('int __stdcall ReleaseDC(void *window, void *dc)'),
 memoryDC:g.func('void * __stdcall CreateCompatibleDC(void *dc)'),
 deleteDC:g.func('int __stdcall DeleteDC(void *dc)'),
 dib:g.func('__stdcall','CreateDIBSection','void *',['void *',k.pointer(bitmapInfo),'uint32',k.out(k.pointer('void *')),'void *','uint32']),
 select:g.func('void * __stdcall SelectObject(void *dc, void *object)'),
 deleteObject:g.func('int __stdcall DeleteObject(void *object)'),
 font:g.func('void * __stdcall CreateFontW(int h, int w, int esc, int orient, int weight, uint32 italic, uint32 underline, uint32 strike, uint32 charset, uint32 out, uint32 clip, uint32 quality, uint32 pitch, str16 face)'),
 textColor:g.func('uint32 __stdcall SetTextColor(void *dc, uint32 color)'),
 backMode:g.func('int __stdcall SetBkMode(void *dc, int mode)'),
 extent:g.func('__stdcall','GetTextExtentPoint32W','int',['void *','str16','int',k.out(k.pointer(size))]),
 text:g.func('int __stdcall TextOutW(void *dc, int x, int y, str16 text, int length)'),
 module:kernel.func('void * __stdcall GetModuleHandleW(str16 name)'),
 proc:kernel.func('void * __stdcall GetProcAddress(void *module, str ansiName)')
};
const EX_STYLE = 0x80000 | 0x20 | 0x8 | 0x8000000 | 0x80;   // LAYERED | TRANSPARENT | TOPMOST | NOACTIVATE | TOOLWINDOW
const WS_POPUP = 0x80000000, HWND_TOPMOST = -1, SWP_NOSIZE = 1, SWP_NOACTIVATE = 0x10, SWP_SHOWWINDOW = 0x40, SW_HIDE = 0, SW_SHOWNOACTIVATE = 4;
// Each state: label and background colour (RGB). The two recording states differ in colour,
// symbol and label so the dictation mode is visible at a glance.
// Each state: label and background colour (RGB). Starting is neutral grey so it is never mistaken
// for recording; the two recording states differ in colour, symbol and label so the dictation mode
// is visible at a glance; Focus moved is an amber warning while recording continues.
const STATES = {
 starting:{label:'○ Starting…', color:[96,96,104]},
 recording:{label:'● Dictating', color:[200,40,40]},
 'recording-talkback':{label:'◆ Talk-back', color:[120,60,200]},
 'focus-moved':{label:'⚠ Focus moved — click back to paste here', color:[214,120,0]},
 transcribing:{label:'… Transcribing', color:[40,100,190]},
 'transcribing-loading':{label:'… Transcribing — loading models…', color:[40,100,190]},
 pasted:{label:'✓ Pasted', color:[30,140,70]},
 'not-pasted':{label:'⧉ Not pasted — copied', color:[160,90,20]},
 failed:{label:'✕ Failed', color:[110,20,20]},
 preparing:{label:'… Preparing reply', color:[20,110,120]},
 speaking:{label:'♪ Speaking', color:[20,130,140]}
};
function describe(state) {
 if (!state || state.name === 'idle' || !STATES[state.name]) return null;
 // A failure shows its reason, for example "✕ Failed — Microphone unavailable".
 if (state.name === 'failed' && state.reason) return {...STATES.failed, label:STATES.failed.label + ' — ' + state.reason};
 return STATES[state.name];
}
class Badge {
 constructor() {
  this.instance = fn.module(null);
  this.className = 'SanskritLearningBadge-' + process.pid + '-' + require('node:crypto').randomUUID();
  const defaultProc = fn.proc(fn.module('user32.dll'), 'DefWindowProcW');
  this.atom = fn.register({size:k.sizeof(windowClass), style:0, proc:defaultProc, classExtra:0, windowExtra:0, instance:this.instance, icon:null, cursor:null, background:null, menu:null, name:this.className, smallIcon:null});
  if (!this.atom) throw Error('Could not register the SanskritLearning badge window.');
  this.window = fn.create(EX_STYLE, this.className, 'SanskritLearning status', WS_POPUP, 0, 0, 1, 1, null, null, this.instance, null);
  if (!this.window) { fn.unregister(this.className, this.instance); throw Error('Could not create the SanskritLearning badge.'); }
  this.enabled = true; this.visible = false; this.state = null; this.drawn = null; this.at = {x:NaN, y:NaN};
 }
 set(state) { this.state = state; this.refresh(); }
 setEnabled(enabled) { this.enabled = !!enabled; this.refresh(); }
 refresh() {
  if (this.closed) return;
  const look = this.enabled ? describe(this.state) : null;
  if (!look) { if (this.visible) { fn.show(this.window, SW_HIDE); this.visible = false; } return; }
  if (this.drawn !== look.label) this.render(look);
  this.tick(true);
  if (!this.visible) { fn.show(this.window, SW_SHOWNOACTIVATE); this.visible = true; }
 }
 // Draws a rounded pill with white text into a premultiplied 32-bit bitmap.
 render(look) {
  const screen = fn.getDC(null), dc = fn.memoryDC(screen);
  const font = fn.font(-12, 0, 0, 0, 600, 0, 0, 0, 1, 0, 0, 5, 0, 'Segoe UI');
  const old = fn.select(dc, font), measure = {};
  fn.extent(dc, look.label, look.label.length, measure);
  const w = measure.cx + 16, h = Math.max(20, measure.cy + 6), bits = [null];
  const bitmap = fn.dib(dc, {size:40, width:w, height:-h, planes:1, bits:32, compression:0, imageSize:0, xppm:0, yppm:0, used:0, important:0, colors:0}, 0, bits, null, 0);
  const oldBitmap = fn.select(dc, bitmap);
  const pixels = new Uint8Array(k.view(bits[0], w * h * 4));
  const [r, gr, b] = look.color, radius = h / 2;
  const coverage = (x, y) => { const cx = Math.min(Math.max(x + .5, radius), w - radius), cy = h / 2; const d = Math.hypot(x + .5 - cx, y + .5 - cy); return Math.max(0, Math.min(1, radius - d + .5)); };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; pixels[i] = b; pixels[i + 1] = gr; pixels[i + 2] = r; pixels[i + 3] = 255; }
  fn.backMode(dc, 1); fn.textColor(dc, 0xffffff);
  fn.text(dc, 8, Math.round((h - measure.cy) / 2), look.label, look.label.length);
  // GDI text leaves alpha undefined: make the pill opaque, then apply the rounded edge (premultiplied).
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4, a = coverage(x, y) * 235; pixels[i] = Math.round(pixels[i] * a / 255); pixels[i + 1] = Math.round(pixels[i + 1] * a / 255); pixels[i + 2] = Math.round(pixels[i + 2] * a / 255); pixels[i + 3] = Math.round(a); }
  this.release();
  Object.assign(this, {dc, bitmap, oldBitmap, font, oldFont:old, w, h, drawn:look.label});
  fn.releaseDC(null, screen);
  this.at = {x:NaN, y:NaN};
 }
 release() { if (!this.dc) return; fn.select(this.dc, this.oldBitmap); fn.select(this.dc, this.oldFont); fn.deleteObject(this.bitmap); fn.deleteObject(this.font); fn.deleteDC(this.dc); this.dc = null; }
 // Follows the pointer: 18 px right and 22 px below it, kept on the virtual screen.
 tick(force = false) {
  if (this.closed || !this.dc || (!this.visible && !force)) return;
  const p = {}; if (!fn.cursor(p)) return;
  const left = fn.metric(76), top = fn.metric(77), right = left + fn.metric(78), bottom = top + fn.metric(79);
  let x = p.x + 18, y = p.y + 22;
  if (x + this.w > right) x = p.x - this.w - 8;
  if (y + this.h > bottom) y = p.y - this.h - 8;
  x = Math.max(left, x); y = Math.max(top, y);
  if (!force && x === this.at.x && y === this.at.y) return;
  this.at = {x, y};
  fn.update(this.window, null, {x, y}, {cx:this.w, cy:this.h}, this.dc, {x:0, y:0}, 0, {op:0, flags:0, alpha:255, format:1}, 2);
  fn.position(this.window, HWND_TOPMOST, x, y, 0, 0, SWP_NOSIZE | SWP_NOACTIVATE | (this.visible ? 0 : SWP_SHOWWINDOW));
 }
 close() { if (this.closed) return; this.closed = true; this.release(); fn.destroy(this.window); fn.unregister(this.className, this.instance); }
}
module.exports = {Badge, describe, STATES, EX_STYLE};
