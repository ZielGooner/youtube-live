const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../manifest.json'), 'utf8'));

class Element {
  constructor(name, attrs = {}) {
    this.name = name;
    this.attrs = new Map(Object.entries(attrs));
    this.childNodes = [];
    this.parentNode = null;
    this.hidden = false;
    this.listeners = new Map();
    this.moves = 0;
    this.rect = { top: 100, left: 0, width: 800, height: 100 };
    this.classes = new Set();
    this.classList = { contains: x => this.classes.has(x) };
    const css = new Map();
    this.style = { getPropertyValue: k => css.get(k) || '', setProperty: (k, v) => css.set(k, v), removeProperty: k => css.delete(k), css };
  }
  get parentElement() { return this.parentNode; }
  get children() { return this.childNodes.filter(node=>node.name!=='#comment'); }
  get isConnected() { return this.name === 'document' || !!this.parentNode?.isConnected; }
  get nextSibling() { return this.parentNode?.childNodes[this.parentNode.childNodes.indexOf(this) + 1] || null; }
  appendChild(n) { return this.insertBefore(n, null); }
  insertBefore(n, before) {
    if (n.parentNode) n.remove();
    n.parentNode = this;
    n.moves++;
    const i = before ? this.childNodes.indexOf(before) : -1;
    this.childNodes.splice(i < 0 ? this.childNodes.length : i, 0, n);
    return n;
  }
  before(n) { this.parentNode.insertBefore(n, this); }
  remove() { if (this.parentNode) { const a = this.parentNode.childNodes; a.splice(a.indexOf(this), 1); this.parentNode = null; } }
  setAttribute(k, v) { this.attrs.set(k, v); }
  getAttribute(k) { return this.attrs.get(k) ?? null; }
  hasAttribute(k) { return this.attrs.has(k); }
  removeAttribute(k) { this.attrs.delete(k); }
  getBoundingClientRect() { return {...this.rect, right:this.rect.left+this.rect.width, bottom:this.rect.top+this.rect.height}; }
  contains(n) { while (n) { if (n === this) return true; n = n.parentNode; } return false; }
  addEventListener(k, cb) { this.listeners.set(k, [...(this.listeners.get(k) || []), cb]); }
  removeEventListener(k, cb) { this.listeners.set(k, (this.listeners.get(k) || []).filter(x => x !== cb)); }
  fire(k, e = {}) { for (const cb of this.listeners.get(k) || []) cb(e); }
  matches(sel) {
    if (sel.includes(',')) return sel.split(',').some(part => this.matches(part.trim()));
    if (sel === 'ytd-watch-flexy:not([hidden])') return this.name === 'ytd-watch-flexy' && !this.hasAttribute('hidden');
    if (sel === '[contenteditable="true"]') return this.getAttribute('contenteditable') === 'true';
    if (sel.startsWith('#')) return this.getAttribute('id') === sel.slice(1);
    if (sel.startsWith('.')) return this.classes.has(sel.slice(1));
    if (sel.includes('[')) return false;
    return this.name === sel;
  }
  querySelectorAll(sel) {
    if (sel === 'ytd-live-chat-frame iframe') return this.querySelector('ytd-live-chat-frame')?.querySelectorAll('iframe') || [];
    const result = [];
    const visit = n => { for (const c of n.children) { if (c.matches(sel)) result.push(c); visit(c); } };
    visit(this);
    return result;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  closest(sel) { let n = this; while (n) { if (n.matches(sel)) return n; n = n.parentNode; } return null; }
}

function fixture(options = {}) {
  if (typeof options === 'boolean') options = { relatedAlreadyBelow: options };
  const doc = new Element('document');
  doc.documentElement = doc.appendChild(new Element('html'));
  doc.documentElement.clientWidth=options.clientWidth || 0;
  doc.documentElement.clientHeight=options.clientHeight || 0;
  doc.createComment = () => new Element('#comment');
  let headerContainer=null,masthead=null,headerMeasures=0;
  if(options.headerHeight!==undefined){
    headerContainer=doc.documentElement.appendChild(new Element('div',{id:'masthead-container'}));
    headerContainer.rect.height=options.headerHeight;headerContainer.rect.top=0;
    if(!options.containerOnly){masthead=headerContainer.appendChild(new Element('ytd-masthead'));masthead.rect.height=options.headerHeight;masthead.rect.top=0;}
    for(const header of [headerContainer,masthead].filter(Boolean))header.getBoundingClientRect=()=>{headerMeasures++;const height=doc.documentElement.hasAttribute('data-ytlp-portrait')?0:header.rect.height;return {...header.rect,height,bottom:header.rect.top+height};};
  }
  const watch = doc.documentElement.appendChild(new Element('ytd-watch-flexy', { 'video-id': 'live1' }));
  if(headerContainer){
    watch.rect.top=options.headerHeight;
    // This mock models only header display:none removing its document-flow
    // height. It does not claim to render the extension CSS or native player.
    watch.getBoundingClientRect=()=>({...watch.rect,top:watch.rect.top-(doc.documentElement.hasAttribute('data-ytlp-portrait')?(masthead||headerContainer).rect.height:0)});
  }
  const playerHost = watch.appendChild(new Element('div', { id: 'full-bleed-container' }));
  const player = playerHost.appendChild(new Element('div', { id: 'movie_player' }));
  player.classes.add('ytp-live');
  const video = player.appendChild(new Element('video'));
  video.videoWidth = 1920; video.videoHeight = 1080;
  const sizeButton = player.appendChild(new Element('button', { 'aria-label': 'Theater mode' }));
  sizeButton.classes.add('ytp-size-button');
  const below = watch.appendChild(new Element('div', { id: 'below' }));
  const infoBox = options.metadataWrapper ? below.appendChild(new Element('div', { id: 'metadata-wrapper' })) : null;
  const metadata = (infoBox || below).appendChild(new Element('ytd-watch-metadata'));
  const titleRow = metadata.appendChild(new Element('div', {id:'title-row'}));
  const titleParent = titleRow.appendChild(new Element('div', {id:'title'}));
  const title = titleParent.appendChild(new Element('h1'));
  const titleLabel = title.appendChild(new Element('yt-formatted-string'));
  titleLabel.textContent='Preserved live title';
  const topRow = metadata.appendChild(new Element('div', {id:'top-row'}));
  const owner = topRow.appendChild(new Element('div', {id:'owner'}));
  const ownerRenderer = owner.appendChild(new Element('ytd-video-owner-renderer'));
  ownerRenderer.appendChild(new Element('a',{id:'avatar'}));
  const uploadInfo = ownerRenderer.appendChild(new Element('div',{id:'upload-info'}));
  const purchase = ownerRenderer.appendChild(new Element('div',{id:'purchase-button',hidden:''}));
  const sponsor = ownerRenderer.appendChild(new Element('div',{id:'sponsor-button'}));
  ownerRenderer.appendChild(new Element('div',{id:'analytics-button',hidden:''}));
  const subscribe = owner.appendChild(new Element('div',{id:'subscribe-button'}));
  const comments = below.appendChild(new Element('ytd-comments'));
  const secondary = watch.appendChild(new Element('div', { id: 'secondary' }));
  // The native secondary column stretches alongside the long primary column;
  // it is not the short sticky host whose height follows chat.
  if(options.chatInSecondaryInner)secondary.rect.height=5000;
  const secondaryInner = options.secondaryInner ? secondary.appendChild(new Element('div',{id:'secondary-inner'})) : null;
  const chatParent = options.chatInBelow ? below.appendChild(new Element('div', { id: 'chat-container' })) :
    options.chatInSecondaryInner && secondaryInner ? secondaryInner.appendChild(new Element('div',{id:'chat-container'})) : secondary;
  const chat = chatParent.appendChild(new Element('ytd-live-chat-frame'));
  const iframe = chat.appendChild(new Element('iframe', { src: 'https://www.youtube.com/live_chat?v=live1' }));
  const messages = [];
  iframe.contentWindow = { postMessage: d => messages.push(d) };
  const home = options.relatedAlreadyBelow ? below : secondaryInner || secondary;
  const related = home.appendChild(new Element('div', { id: 'related' }));
  related.appendChild(new Element('ytd-watch-next-secondary-results-renderer'));
  const frames = [];
  const mutationObservers = [], resizeObservers = [];
  const intervalCallbacks = [];
  const operations = {queries:0,rectReads:0,attributeWrites:0,styleWrites:0,queuedFrames:0};
  const instrument = el => {
    for(const [method,counter]of [['querySelectorAll','queries'],['getBoundingClientRect','rectReads'],['setAttribute','attributeWrites'],['removeAttribute','attributeWrites']]){
      const original=el[method];el[method]=function(...args){operations[counter]++;return original.apply(this,args);};
    }
    for(const method of ['setProperty','removeProperty']){
      const original=el.style[method];el.style[method]=(...args)=>{operations.styleWrites++;return original(...args);};
    }
    for(const child of el.children)instrument(child);
  };
  instrument(doc);
  let nativeResizeEvents = 0;
  let settingsCallback, storageCallback, messageCallback;
  const global = {
    document: doc, location: { pathname: '/watch', href: 'https://www.youtube.com/watch?v=live1', origin: 'https://www.youtube.com' },
    innerHeight: 1000, innerWidth: 800, scrollY: 0, URL, console,
    Event: class { constructor(type) { this.type = type; } },
    requestAnimationFrame: cb => {operations.queuedFrames++;return frames.push(cb);},
    setInterval: cb => {intervalCallbacks.push(cb);return intervalCallbacks.length;},
    getComputedStyle: () => ({ visibility: 'visible' }),
    MutationObserver: class {
      constructor(callback) { this.callback = callback; this.observations = []; mutationObservers.push(this); }
      observe(target, config) { this.observations.push({ target, config }); }
      disconnect() { this.observations = []; }
    },
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; this.targets = new Set(); resizeObservers.push(this); }
      observe(target) { this.targets.add(target); }
      disconnect() { this.targets.clear(); }
    },
    chrome: {
      storage: { local: { get: (_defaults, cb) => { settingsCallback = cb; } }, onChanged: { addListener: cb => { storageCallback = cb; } } },
      runtime: { onMessage: { addListener: cb => { messageCallback = cb; } } }
    }
  };
  global.window = global; global.top = global;
  global.addEventListener = (k, cb) => doc.addEventListener(`window:${k}`, cb);
  global.dispatchEvent = event => { if (event.type === 'resize') nativeResizeEvents++; doc.fire(`window:${event.type}`, event); return true; };
  vm.runInNewContext(source, global, { filename: 'content.js' });
  const flush = () => { let n = 0; while (frames.length) { if (++n > 100) throw new Error('RAF loop'); frames.shift()(); } };
  const frame = () => { frames.shift()?.(); };
  const event = k => { doc.fire(`window:${k}`); doc.fire(k); flush(); };
  const status = () => { let result; messageCallback({ type: 'ytlp:get-status' }, {}, d => { result = d; }); return result; };
  const settings = enabled => { settingsCallback({ enabled }); flush(); };
  const changeEnabled = enabled => { storageCallback({ enabled: { newValue: enabled } }, 'local'); flush(); };
  const mutate = (target, attributeName, value) => {
    if (value === null) target.removeAttribute(attributeName); else target.setAttribute(attributeName, value);
    for (const observer of mutationObservers) {
      if (observer.observations.some(({target: root, config}) => (root === target || (config.subtree && root.contains(target))) && config.attributes && (!config.attributeFilter || config.attributeFilter.includes(attributeName)))) observer.callback([{ type: 'attributes', target, attributeName }]);
    }
    flush();
  };
  const resizeInfo = (height, target = infoBox || metadata) => {
    target.rect.height = height;
    for (const observer of resizeObservers) if (observer.targets.has(target)) observer.callback([{target, contentRect:target.rect}]);
    flush();
  };
  const resetOperations=()=>{for(const key of Object.keys(operations))operations[key]=0;};
  const heartbeat=()=>{for(const callback of intervalCallbacks)callback();flush();};
  return { global, doc, watch, headerContainer,masthead,headerMeasureCount:()=>headerMeasures,playerHost, player, video, sizeButton, below, metadata, infoBox:infoBox || metadata, titleRow,titleParent,title,titleLabel,owner,ownerRenderer,uploadInfo,purchase,sponsor,subscribe,comments, secondary,secondaryInner, chat, iframe, related, home, messages, flush, frame, event, status, settings, changeEnabled, mutate, resizeInfo, resizeObservers, mutationObservers, heartbeat, resetOperations, operations:()=>({...operations}), nativeResizeCount:()=>nativeResizeEvents };
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS ${name}`); passed++; }
  catch (e) { console.error(`FAIL ${name}: ${e.message.split('\n')[0]}`); failed++; }
}

test('waits for saved settings; stored OFF causes no layout or recommendation moves', () => {
  const f = fixture(); f.flush();
  assert.equal(f.status().reason, 'loading'); assert.equal(f.status().active, false);
  f.settings(false); assert.equal(f.status().reason, 'disabled');
  assert.equal(f.related.parentNode, f.home);
  assert.equal(f.watch.hasAttribute('data-ytlp-active'), false);
  assert.equal(f.watch.hasAttribute('data-ytlp-orientation'), false);
});

test('a live OFF setting wins over a late initial ON read without activating the layout', () => {
  const f=fixture();f.changeEnabled(false);
  assert.equal(f.status().enabled,false);assert.equal(f.status().active,false);
  f.resetOperations();f.settings(true);
  assert.equal(f.status().enabled,false);assert.equal(f.status().reason,'disabled');assert.equal(f.status().active,false);
  assert.equal(f.related.parentNode,f.home);assert.equal(f.watch.hasAttribute('data-ytlp-active'),false);
  assert.deepEqual(f.operations(),{queries:0,rectReads:0,attributeWrites:0,styleWrites:0,queuedFrames:0});
});

test('a live ON setting wins over a late initial OFF read and later toggles remain effective', () => {
  const f=fixture();f.changeEnabled(true);
  assert.equal(f.status().enabled,true);assert.equal(f.status().mode,'normal');
  f.resetOperations();f.settings(false);
  assert.equal(f.status().enabled,true);assert.equal(f.status().mode,'normal');assert.equal(f.status().active,true);
  assert.deepEqual(f.operations(),{queries:0,rectReads:0,attributeWrites:0,styleWrites:0,queuedFrames:0});
  f.changeEnabled(false);assert.equal(f.status().active,false);assert.equal(f.related.parentNode,f.home);
  f.changeEnabled(true);assert.equal(f.status().mode,'normal');assert.equal(f.status().active,true);
});

test('normal -> portrait theater -> landscape theater -> normal -> OFF restores media and recommendations', () => {
  const f = fixture(); const media = [f.video, f.iframe, f.playerHost, f.chat].map(n => [n, n.parentNode, n.moves]);
  f.settings(true); assert.equal(f.status().mode, 'normal'); assert.equal(f.related.parentNode, f.below);
  assert.equal(f.watch.getAttribute('data-ytlp-orientation'),'portrait');
  assert.equal(f.related.nextSibling, f.comments);
  f.sizeButton.setAttribute('aria-label', 'Default view'); f.event('resize');
  assert.equal(f.status().mode, 'portrait-theater'); assert.equal(f.related.parentNode, f.watch);
  assert.equal(f.watch.getAttribute('data-ytlp-orientation'),'portrait');
  for (const name of ['player-height','chat-height']) assert.ok(parseFloat(f.watch.style.getPropertyValue(`--ytlp-${name}`)) > 0);
  f.global.innerWidth = 1200; f.event('resize');
  assert.equal(f.status().reason, 'landscape-theater'); assert.equal(f.related.parentNode, f.below); assert.equal(f.watch.style.css.size, 0);
  assert.equal(f.watch.getAttribute('data-ytlp-orientation'),'landscape');
  assert.equal(f.metadata.nextSibling,f.related);assert.equal(f.title.parentNode,f.titleParent);
  f.sizeButton.setAttribute('aria-label', 'Theater mode'); f.event('resize');
  assert.equal(f.status().mode, 'normal'); assert.equal(f.related.parentNode, f.below);
  assert.equal(f.watch.getAttribute('data-ytlp-orientation'),'landscape');
  assert.equal(f.watch.style.css.size, 1);
  f.changeEnabled(false); assert.equal(f.related.parentNode, f.home); assert.equal(f.watch.style.css.size, 0);
  assert.equal(f.watch.hasAttribute('data-ytlp-orientation'),false);
  for (const [n, parent, moves] of media) { assert.equal(n.parentNode, parent); assert.equal(n.moves, moves); }
});

test('fullscreen and replay URL do not activate', () => {
  const f = fixture(); f.doc.fullscreenElement = f.player; f.settings(true);
  assert.equal(f.status().reason, 'fullscreen');
  f.doc.fullscreenElement = null; f.iframe.setAttribute('src', 'https://www.youtube.com/live_chat_replay?v=live1'); f.event('resize');
  assert.equal(f.status().reason, 'not-live'); assert.equal(f.related.parentNode, f.home);
});

test('SPA start restores recommendations; finish reactivates current watch', () => {
  const f = fixture(); f.settings(true); f.event('yt-navigate-start');
  assert.equal(f.related.parentNode, f.home); assert.equal(f.status().active, false);
  f.event('yt-navigate-finish'); assert.equal(f.status().mode, 'normal'); assert.equal(f.related.parentNode, f.below);
});

test('discarded original recommendation subtree does not leave a duplicate', () => {
  const f = fixture(); f.sizeButton.setAttribute('aria-label', 'Default view'); f.settings(true);
  assert.equal(f.related.parentNode, f.watch); f.secondary.remove(); f.changeEnabled(false);
  assert.equal(f.related.isConnected, false);
});

test('recommendations already in #below move directly after metadata, before comments', () => {
  const f = fixture(true); f.settings(true);
  assert.equal(f.metadata.nextSibling, f.related);
  f.changeEnabled(false); assert.equal(f.comments.nextSibling, f.related);
});

test('current tooltip wins over stale aria-label in both directions and mutations trigger updates', () => {
  const f = fixture();
  f.sizeButton.setAttribute('aria-label', '기본 보기 (t)');
  f.sizeButton.setAttribute('data-title-no-tooltip', '영화관 모드 (t)');
  f.settings(true);
  assert.equal(f.status().mode, 'normal');
  f.mutate(f.sizeButton, 'data-title-no-tooltip', '기본 보기 (t)');
  assert.equal(f.status().mode, 'portrait-theater');
  const beforeExit=f.nativeResizeCount();
  f.sizeButton.setAttribute('aria-label', '기본 보기 (t)');
  f.mutate(f.sizeButton, 'data-title-no-tooltip', '영화관 모드 (t)');
  assert.equal(f.status().mode, 'normal');
  assert.equal(f.nativeResizeCount(), beforeExit+1);
});

test('tooltip/title fallbacks and watch-while attribute changes are observed', () => {
  const f = fixture();
  f.sizeButton.setAttribute('aria-label', 'unrecognized');
  f.sizeButton.setAttribute('data-title-no-tooltip', 'unrecognized');
  f.sizeButton.setAttribute('data-tooltip-title', 'Default view');
  f.settings(true); assert.equal(f.status().mode, 'portrait-theater');
  f.mutate(f.sizeButton, 'data-tooltip-title', null);
  assert.equal(f.status().mode, 'normal');
  f.mutate(f.sizeButton, 'title', '기본 보기 (t)');
  assert.equal(f.status().mode, 'portrait-theater');
  f.mutate(f.sizeButton, 'title', null);
  f.mutate(f.watch, 'theater', '');
  assert.equal(f.status().mode, 'portrait-theater');
  f.mutate(f.watch, 'watch-while-panels-active', '');
  assert.equal(f.status().mode, 'normal');
});

test('native chat inside #below is supported without media or metadata reparenting', () => {
  const f = fixture({chatInBelow:true,metadataWrapper:true});
  const immutable = [f.playerHost,f.video,f.infoBox,f.metadata,f.chat,f.iframe].map(node=>[node,node.parentNode,node.moves]);
  f.sizeButton.setAttribute('data-title-no-tooltip','Default view'); f.settings(true);
  assert.equal(f.status().mode, 'portrait-theater');
  assert.equal(f.infoBox.getAttribute('data-ytlp-part'), 'info');
  assert.equal(f.below.hasAttribute('data-ytlp-flow'), true);
  assert.equal(f.chat.parentNode.hasAttribute('data-ytlp-flow'), true);
  assert.equal(f.infoBox.hasAttribute('data-ytlp-flow'), false);
  for(const [node,parent,moves] of immutable) { assert.equal(node.parentNode,parent); assert.equal(node.moves,moves); }
  f.changeEnabled(false);
  for(const [node,parent,moves] of immutable) { assert.equal(node.parentNode,parent); assert.equal(node.moves,moves); }
});

test('metadata containing chat is refused instead of flattening the chat away', () => {
  const f = fixture(); f.metadata.appendChild(f.chat);
  f.sizeButton.setAttribute('data-title-no-tooltip','Default view'); f.settings(true);
  assert.equal(f.status().reason,'unsupported'); assert.equal(f.status().active,false);
  assert.equal(f.watch.hasAttribute('data-ytlp-active'),false);
});

test('portrait exit removes all flow markers and portrait sizes while retaining native inline styles', () => {
  const f = fixture({chatInBelow:true});
  f.watch.style.setProperty('--native-width','654px');
  f.player.style.setProperty('width','654px'); f.video.style.setProperty('left','4px');
  f.sizeButton.setAttribute('data-title-no-tooltip','Default view'); f.settings(true);
  assert.equal(f.below.hasAttribute('data-ytlp-flow'),true);
  f.mutate(f.sizeButton,'data-title-no-tooltip','Theater mode');
  assert.equal(f.status().mode,'normal');
  for(const node of [f.below,f.secondary,f.chat.parentNode]) assert.equal(node.hasAttribute('data-ytlp-flow'),false);
  assert.equal(f.playerHost.hasAttribute('data-ytlp-part'),false);
  assert.equal(f.infoBox.hasAttribute('data-ytlp-part'),false);
  assert.equal(f.watch.style.getPropertyValue('--ytlp-player-height'),'');
  assert.equal(f.watch.style.getPropertyValue('--native-width'),'654px');
  assert.equal(f.player.style.getPropertyValue('width'),'654px'); assert.equal(f.video.style.getPropertyValue('left'),'4px');
  f.changeEnabled(false);
  assert.equal(f.watch.style.getPropertyValue('--ytlp-chat-height'),'');
  assert.equal(f.chat.hasAttribute('data-ytlp-part'),false);
  assert.equal(f.related.hasAttribute('data-ytlp-part'),false);
});

test('metadata ResizeObserver recalculates remaining chat height and disconnects on normal mode', () => {
  const f = fixture({metadataWrapper:true});
  f.global.innerHeight=1200;
  f.sizeButton.setAttribute('data-title-no-tooltip','Default view'); f.settings(true);
  const initialPlayer = parseFloat(f.watch.style.getPropertyValue('--ytlp-player-height'));
  const initialChat = parseFloat(f.watch.style.getPropertyValue('--ytlp-chat-height'));
  assert.ok(f.resizeObservers.some(observer=>observer.targets.has(f.infoBox)));
  f.resizeInfo(150);
  assert.equal(parseFloat(f.watch.style.getPropertyValue('--ytlp-player-height')),initialPlayer);
  assert.equal(parseFloat(f.watch.style.getPropertyValue('--ytlp-chat-height')),initialChat-50);
  f.resizeInfo(2000);
  assert.ok(parseFloat(f.watch.style.getPropertyValue('--ytlp-player-height'))>=0);
  assert.ok(parseFloat(f.watch.style.getPropertyValue('--ytlp-chat-height'))>=360);
  assert.ok(parseFloat(f.watch.style.getPropertyValue('--ytlp-info-max-height'))>=0);
  f.mutate(f.sizeButton,'data-title-no-tooltip','Theater mode');
  assert.ok(f.resizeObservers.every(observer=>observer.targets.size===0));
  const normalHeight=f.watch.style.getPropertyValue('--ytlp-chat-height');
  f.resizeInfo(300);
  assert.equal(f.watch.style.getPropertyValue('--ytlp-chat-height'),normalHeight);
});

test('mode button capture removes overrides before native handling and requests one resize after two frames', () => {
  const f = fixture({chatInBelow:true});
  f.sizeButton.setAttribute('data-title-no-tooltip','Default view'); f.settings(true);
  const beforeExit=f.nativeResizeCount();
  f.doc.fire('click',{target:f.sizeButton});
  assert.equal(f.status().active,false); assert.equal(f.watch.hasAttribute('data-ytlp-active'),false);
  assert.equal(f.below.hasAttribute('data-ytlp-flow'),false);
  assert.equal(f.nativeResizeCount(),beforeExit);
  f.sizeButton.setAttribute('data-title-no-tooltip','Theater mode');
  f.frame(); assert.equal(f.nativeResizeCount(),beforeExit);
  f.frame(); assert.equal(f.nativeResizeCount(),beforeExit+1);
  f.flush(); assert.equal(f.status().mode,'normal');
  for(let i=0;i<5;i++)f.event('resize');
  assert.equal(f.nativeResizeCount(),beforeExit+1);
});

test('editing shortcuts are ignored, but t on the player safely releases portrait mode', () => {
  const f = fixture(); f.sizeButton.setAttribute('data-title-no-tooltip','Default view'); f.settings(true);
  const beforeExit=f.nativeResizeCount();
  const input=f.below.appendChild(new Element('input'));
  const editable=f.below.appendChild(new Element('div',{contenteditable:'true'}));
  f.doc.fire('keydown',{target:input,key:'t'});
  f.doc.fire('keydown',{target:editable,key:'f'});
  f.doc.fire('keydown',{target:f.video,key:'t',ctrlKey:true});
  assert.equal(f.status().mode,'portrait-theater'); assert.equal(f.nativeResizeCount(),beforeExit);
  f.doc.fire('keydown',{target:f.video,key:'t'});
  assert.equal(f.status().active,false);
  f.sizeButton.setAttribute('data-title-no-tooltip','Theater mode'); f.flush();
  assert.equal(f.status().mode,'normal'); assert.equal(f.nativeResizeCount(),beforeExit+1);
});

test('fullscreen from portrait restores markers and returns after exit without repeated resize dispatch', () => {
  const f = fixture({chatInBelow:true}); f.sizeButton.setAttribute('data-title-no-tooltip','Default view'); f.settings(true);
  const beforeExit=f.nativeResizeCount();
  f.doc.fullscreenElement=f.player; f.event('fullscreenchange');
  assert.equal(f.status().reason,'fullscreen'); assert.equal(f.below.hasAttribute('data-ytlp-flow'),false);
  assert.equal(f.related.parentNode,f.home); assert.equal(f.nativeResizeCount(),beforeExit+1);
  f.event('fullscreenchange'); assert.equal(f.nativeResizeCount(),beforeExit+1);
  f.doc.fullscreenElement=null; f.event('fullscreenchange');
  assert.equal(f.status().mode,'portrait-theater');
  assert.ok(f.resizeObservers.some(observer=>observer.targets.has(f.infoBox)));
});

test('SPA start during native settling does not reactivate the departing watch', () => {
  const f=fixture(); f.sizeButton.setAttribute('data-title-no-tooltip','Default view'); f.settings(true);
  f.doc.fire('click',{target:f.sizeButton});
  f.event('yt-navigate-start');
  assert.equal(f.status().active,false); assert.equal(f.related.parentNode,f.home);
  assert.equal(f.watch.hasAttribute('data-ytlp-active'),false);
  f.sizeButton.setAttribute('data-title-no-tooltip','Theater mode'); f.event('yt-navigate-finish');
  assert.equal(f.status().mode,'normal');
});

test('client viewport excludes scrollbar pixels from portrait and normal chat budgets', () => {
  const f=fixture({clientWidth:800,clientHeight:1255});
  f.global.innerWidth=815; f.global.innerHeight=1270; f.watch.rect.top=56;
  f.sizeButton.setAttribute('data-title-no-tooltip','Default view'); f.settings(true);
  const amount=name=>parseFloat(f.watch.style.getPropertyValue(`--ytlp-${name}`));
  assert.equal(amount('info-max-height'),299.75);
  assert.equal(56+amount('player-height')+f.infoBox.rect.height+10+amount('chat-height'),1255);
  assert.ok(amount('chat-height')>=360);
  assert.equal(f.nativeResizeCount(),1);
  f.mutate(f.sizeButton,'data-title-no-tooltip','Theater mode');
  assert.equal(amount('chat-height'),1243-f.chat.rect.top);
  assert.equal(f.watch.style.getPropertyValue('--ytlp-info-max-height'),'');
});

test('portrait eligibility uses client dimensions when scrollbars cross the 3 percent allowance', () => {
  const f=fixture({clientWidth:800,clientHeight:775});
  f.global.innerWidth=800;f.global.innerHeight=810;
  f.sizeButton.setAttribute('data-title-no-tooltip','Default view');f.settings(true);
  assert.equal(f.status().reason,'landscape-theater');assert.equal(f.status().active,true);
  assert.equal(f.title.parentNode,f.titleParent);
  assert.equal(f.metadata.nextSibling,f.related);assert.equal(f.watch.style.css.size,0);
});

test('video yields height to minimum chat budget and tiny portrait windows restore native layout', () => {
  const f=fixture({clientWidth:600,clientHeight:800});
  f.global.innerWidth=600;f.global.innerHeight=815;f.watch.rect.top=56;f.watch.rect.width=600;f.infoBox.rect.height=180;
  f.sizeButton.setAttribute('data-title-no-tooltip','Default view');f.settings(true);
  const amount=name=>parseFloat(f.watch.style.getPropertyValue(`--ytlp-${name}`));
  assert.equal(amount('info-max-height'),186);
  assert.equal(amount('player-height'),194);assert.equal(amount('chat-height'),360);
  f.doc.documentElement.clientWidth=300;f.doc.documentElement.clientHeight=430;f.watch.rect.top=56;f.event('resize');
  assert.equal(f.status().reason,'viewport-small');assert.equal(f.status().active,false);
  for(const name of ['player-height','chat-height','info-max-height'])assert.equal(f.watch.style.getPropertyValue(`--ytlp-${name}`),'');
  assert.equal(f.title.parentNode,f.titleParent);assert.equal(f.below.hasAttribute('data-ytlp-flow'),false);
});

test('original title node appears after channel and before join controls, then restores on OFF', () => {
  const f=fixture({metadataWrapper:true});
  let clicks=0;f.title.addEventListener('click',()=>clicks++);
  const originalLabel=f.titleLabel, originalParent=f.titleParent;
  const stable=[f.video,f.playerHost,f.iframe,f.chat,f.uploadInfo,f.sponsor,f.subscribe].map(node=>[node,node.parentNode,node.moves]);
  f.sizeButton.setAttribute('data-title-no-tooltip','Default view');f.settings(true);
  assert.equal(f.metadata.querySelector('h1'),f.title);
  assert.equal(f.title.parentNode,f.ownerRenderer);assert.equal(f.uploadInfo.nextSibling,f.title);
  assert.equal(f.title.nextSibling,f.purchase);assert.equal(f.subscribe.parentNode,f.owner);
  assert.equal(f.title.getAttribute('data-ytlp-part'),'title');assert.equal(f.titleRow.hasAttribute('data-ytlp-empty-title'),true);
  assert.equal(f.title.children[0],originalLabel);f.title.fire('click');assert.equal(clicks,1);
  const moves=f.title.moves;
  for(let i=0;i<3;i++)f.event('resize');assert.equal(f.title.moves,moves);
  f.changeEnabled(false);
  assert.equal(f.title.parentNode,originalParent);assert.equal(f.titleRow.hasAttribute('data-ytlp-empty-title'),false);
  assert.equal(f.title.hasAttribute('data-ytlp-part'),false);assert.equal(f.title.children[0],originalLabel);
  f.title.fire('click');assert.equal(clicks,2);
  assert.equal(f.metadata.querySelectorAll('h1').length,1);
  for(const [node,parent,moveCount]of stable){assert.equal(node.parentNode,parent);assert.equal(node.moves,moveCount);}
});

test('normal mode never moves title; normal and SPA return restore its exact source location', () => {
  const f=fixture();const originalMoves=f.title.moves;f.settings(true);
  assert.equal(f.title.moves,originalMoves);assert.equal(f.title.parentNode,f.titleParent);
  f.mutate(f.sizeButton,'data-title-no-tooltip','Default view');assert.equal(f.title.parentNode,f.ownerRenderer);
  f.mutate(f.sizeButton,'data-title-no-tooltip','Theater mode');assert.equal(f.title.parentNode,f.titleParent);
  assert.equal(f.titleRow.hasAttribute('data-ytlp-empty-title'),false);
  f.mutate(f.sizeButton,'data-title-no-tooltip','Default view');f.event('yt-navigate-start');
  assert.equal(f.title.parentNode,f.titleParent);assert.equal(f.titleRow.hasAttribute('data-ytlp-empty-title'),false);
});

test('discarded title origin is not resurrected or left as a duplicate in the owner row', () => {
  const f=fixture();f.sizeButton.setAttribute('data-title-no-tooltip','Default view');f.settings(true);
  f.titleRow.remove();f.changeEnabled(false);
  assert.equal(f.title.isConnected,false);assert.equal(f.ownerRenderer.querySelector('h1'),null);
  assert.equal(f.titleRow.hasAttribute('data-ytlp-empty-title'),false);
});

test('native resize notification runs only for entry and actual client viewport changes', () => {
  const f=fixture({clientWidth:800,clientHeight:1255});
  f.global.innerHeight=1270;f.sizeButton.setAttribute('data-title-no-tooltip','Default view');f.settings(true);
  assert.equal(f.nativeResizeCount(),1);
  for(let i=0;i<8;i++)f.event('resize');assert.equal(f.nativeResizeCount(),1);
  f.watch.rect.width=700;f.event('resize');assert.equal(f.nativeResizeCount(),1);
  f.resizeInfo(110);assert.equal(f.nativeResizeCount(),1);
  f.watch.rect.width=650;f.event('resize');assert.equal(f.nativeResizeCount(),1);
  f.doc.documentElement.clientWidth=780;f.event('resize');assert.equal(f.nativeResizeCount(),2);
  f.event('resize');assert.equal(f.nativeResizeCount(),2);
  f.doc.documentElement.clientHeight=1200;f.event('resize');assert.equal(f.nativeResizeCount(),3);
  f.global.innerHeight=1400;f.global.innerWidth=900;f.event('resize');assert.equal(f.nativeResizeCount(),3);
  f.changeEnabled(false);assert.equal(f.nativeResizeCount(),4);
  f.event('resize');assert.equal(f.nativeResizeCount(),4);
  f.changeEnabled(true);assert.equal(f.nativeResizeCount(),5);
  f.event('resize');assert.equal(f.nativeResizeCount(),5);
});

test('metadata maximum honors both quarter-stage and reserved player/chat limits', () => {
  const f=fixture({clientWidth:400,clientHeight:596});
  f.global.innerWidth=400;f.global.innerHeight=611;f.watch.rect.top=56;f.infoBox.rect.height=50;
  f.sizeButton.setAttribute('data-title-no-tooltip','Default view');f.settings(true);
  const value=()=>parseFloat(f.watch.style.getPropertyValue('--ytlp-info-max-height'));
  assert.equal(value(),90);
  assert.ok(value()<(596-56)*.25);
  f.doc.documentElement.clientHeight=1000;f.event('resize');
  assert.equal(value(),236);
  assert.ok(value()<944-360-80-10);
});

test('measured chat chrome overhead reserves at least 322px inside the iframe', () => {
  const f=fixture();f.chat.rect.height=480;f.iframe.rect.height=400.25;
  f.sizeButton.setAttribute('data-title-no-tooltip','Default view');f.settings(true);
  const chatHeight=parseFloat(f.watch.style.getPropertyValue('--ytlp-chat-height'));
  assert.equal(chatHeight,402);
  assert.ok(chatHeight-(480-400.25)>=322);
  assert.equal(parseFloat(f.watch.style.getPropertyValue('--ytlp-player-height')),388);
  assert.equal(f.iframe.parentNode,f.chat);
});

test('zero-size or oversized iframe does not inflate the minimum chat allocation', () => {
  for(const frameHeight of [0,600]){
    const f=fixture();f.chat.rect.height=480;f.iframe.rect.height=frameHeight;
    f.sizeButton.setAttribute('data-title-no-tooltip','Default view');f.settings(true);
    assert.equal(parseFloat(f.watch.style.getPropertyValue('--ytlp-chat-height')),360);
    assert.equal(parseFloat(f.watch.style.getPropertyValue('--ytlp-player-height')),430);
  }
});

test('small portrait fallback uses client height and activates at the 500px boundary', () => {
  const f=fixture({clientWidth:300,clientHeight:499});
  f.global.innerWidth=300;f.global.innerHeight=514;f.watch.rect.top=56;f.infoBox.rect.height=0;
  f.sizeButton.setAttribute('data-title-no-tooltip','Default view');f.settings(true);
  assert.equal(f.status().reason,'viewport-small');assert.equal(f.nativeResizeCount(),0);
  assert.equal(f.title.parentNode,f.titleParent);
  f.doc.documentElement.clientHeight=500;f.event('resize');
  assert.equal(f.status().mode,'portrait-theater');
  assert.equal(parseFloat(f.watch.style.getPropertyValue('--ytlp-player-height')),74);
  f.doc.documentElement.clientHeight=499;f.event('resize');
  assert.equal(f.status().reason,'viewport-small');assert.equal(f.title.parentNode,f.titleParent);
  f.mutate(f.sizeButton,'data-title-no-tooltip','Theater mode');
  assert.equal(f.status().mode,'normal');
});

test('h1 carrying id=title is relocated without hiding itself', () => {
  const f=fixture();
  f.metadata.insertBefore(f.title,f.titleRow);f.titleRow.remove();f.title.setAttribute('id','title');
  f.sizeButton.setAttribute('data-title-no-tooltip','Default view');f.settings(true);
  assert.equal(f.title.parentNode,f.ownerRenderer);
  assert.equal(f.title.hasAttribute('data-ytlp-empty-title'),false);
  assert.equal(f.title.getAttribute('data-ytlp-part'),'title');
  f.changeEnabled(false);
  assert.equal(f.title.parentNode,f.metadata);assert.equal(f.title.hasAttribute('data-ytlp-empty-title'),false);
  assert.equal(f.metadata.querySelectorAll('h1').length,1);
});

test('native replacement in original title slot prevents duplicate old-title restoration', () => {
  const f=fixture();f.sizeButton.setAttribute('data-title-no-tooltip','Default view');f.settings(true);
  const replacement=f.titleParent.appendChild(new Element('h1'));
  replacement.textContent='Native replacement title';
  f.changeEnabled(false);
  assert.equal(f.title.isConnected,false);assert.equal(replacement.parentNode,f.titleParent);
  assert.deepEqual(f.metadata.querySelectorAll('h1'),[replacement]);
  assert.equal(f.titleRow.hasAttribute('data-ytlp-empty-title'),false);
});

test('native replacement title can be adopted while active and later restored exactly once', () => {
  const f=fixture();f.sizeButton.setAttribute('data-title-no-tooltip','Default view');f.settings(true);
  const replacement=f.titleParent.appendChild(new Element('h1'));
  f.event('yt-page-data-updated');
  assert.equal(f.title.isConnected,false);assert.equal(replacement.parentNode,f.ownerRenderer);
  assert.equal(f.uploadInfo.nextSibling,replacement);assert.deepEqual(f.metadata.querySelectorAll('h1'),[replacement]);
  f.changeEnabled(false);
  assert.equal(replacement.parentNode,f.titleParent);assert.deepEqual(f.metadata.querySelectorAll('h1'),[replacement]);
});

test('hiding the 56px masthead gives all recovered space to chat while preserving video/info budget', () => {
  const withHeader=fixture({headerHeight:56}),baseline=fixture();
  baseline.watch.rect.top=56;
  for(const f of [withHeader,baseline]){f.infoBox.rect.height=200;f.sizeButton.setAttribute('data-title-no-tooltip','Default view');f.settings(true);}
  const value=(f,name)=>parseFloat(f.watch.style.getPropertyValue(`--ytlp-${name}`));
  assert.equal(withHeader.doc.documentElement.hasAttribute('data-ytlp-portrait'),true);
  assert.equal(withHeader.watch.getBoundingClientRect().top,0);
  assert.equal(value(withHeader,'player-height')+value(withHeader,'chat-height')-value(baseline,'player-height')-value(baseline,'chat-height'),56);
  assert.equal(value(withHeader,'player-height'),value(baseline,'player-height'));
  assert.equal(value(withHeader,'info-max-height'),value(baseline,'info-max-height'));
  assert.equal(value(withHeader,'chat-height')-value(baseline,'chat-height'),56);
  assert.equal(value(withHeader,'player-height')+200+10+value(withHeader,'chat-height'),1000);
  assert.equal(withHeader.headerMeasureCount(),1);
  for(let i=0;i<6;i++)withHeader.event('resize');
  assert.equal(withHeader.headerMeasureCount(),1);
  assert.equal(value(withHeader,'chat-height'),416);
});

test('masthead selector is preferred and container fallback also returns header space to chat', () => {
  const preferred=fixture({headerHeight:56});preferred.headerContainer.rect.height=120;
  preferred.sizeButton.setAttribute('data-title-no-tooltip','Default view');preferred.settings(true);
  assert.equal(parseFloat(preferred.watch.style.getPropertyValue('--ytlp-info-max-height')),236);
  const fallback=fixture({headerHeight:56,containerOnly:true});
  fallback.sizeButton.setAttribute('data-title-no-tooltip','Default view');fallback.settings(true);
  assert.equal(fallback.doc.documentElement.hasAttribute('data-ytlp-portrait'),true);
  assert.equal(parseFloat(fallback.watch.style.getPropertyValue('--ytlp-player-height'))+fallback.infoBox.rect.height+10+parseFloat(fallback.watch.style.getPropertyValue('--ytlp-chat-height')),1000);
  assert.equal(parseFloat(fallback.watch.style.getPropertyValue('--ytlp-player-height')),450);
  assert.equal(parseFloat(fallback.watch.style.getPropertyValue('--ytlp-chat-height')),440);
  assert.equal(fallback.headerMeasureCount(),1);
});

test('normal, fullscreen, OFF and SPA transitions remove the global header-hiding attribute', () => {
  for(const exit of ['normal','fullscreen','off','spa']){
    const f=fixture({headerHeight:56});
    f.sizeButton.setAttribute('data-title-no-tooltip','Default view');f.settings(true);
    assert.equal(f.doc.documentElement.hasAttribute('data-ytlp-portrait'),true);
    if(exit==='normal')f.mutate(f.sizeButton,'data-title-no-tooltip','Theater mode');
    if(exit==='fullscreen'){f.doc.fullscreenElement=f.player;f.event('fullscreenchange');}
    if(exit==='off')f.changeEnabled(false);
    if(exit==='spa')f.event('yt-navigate-start');
    assert.equal(f.doc.documentElement.hasAttribute('data-ytlp-portrait'),false,exit);
    assert.equal(f.watch.getBoundingClientRect().top,56,exit);
    assert.equal(f.watch.style.getPropertyValue('--ytlp-player-height'),'',exit);
    assert.equal(f.title.parentNode,f.titleParent,exit);
  }
});

test('deactivation clears cached header height and re-entry measures the current header', () => {
  const f=fixture({headerHeight:56});f.infoBox.rect.height=200;
  f.sizeButton.setAttribute('data-title-no-tooltip','Default view');f.settings(true);
  assert.equal(f.headerMeasureCount(),1);
  f.changeEnabled(false);f.masthead.rect.height=64;f.headerContainer.rect.height=64;f.watch.rect.top=64;
  f.changeEnabled(true);
  assert.equal(f.headerMeasureCount(),2);
  assert.equal(f.doc.documentElement.hasAttribute('data-ytlp-portrait'),true);
  assert.equal(parseFloat(f.watch.style.getPropertyValue('--ytlp-player-height')),366);
  assert.equal(parseFloat(f.watch.style.getPropertyValue('--ytlp-chat-height')),424);
  assert.equal(parseFloat(f.watch.style.getPropertyValue('--ytlp-info-max-height')),234);
});

test('inactive normal and undersized theater pages never hide the masthead', () => {
  const f=fixture({headerHeight:56});f.settings(true);
  assert.equal(f.status().mode,'normal');assert.equal(f.doc.documentElement.hasAttribute('data-ytlp-portrait'),false);
  assert.equal(f.headerMeasureCount(),0);
  f.doc.documentElement.clientWidth=300;f.doc.documentElement.clientHeight=499;
  f.mutate(f.sizeButton,'data-title-no-tooltip','Default view');
  assert.equal(f.status().reason,'viewport-small');assert.equal(f.doc.documentElement.hasAttribute('data-ytlp-portrait'),false);
  assert.equal(f.headerMeasureCount(),0);
});

test('alternating constrained metadata heights updates video/chat without synthetic resize feedback', () => {
  const f=fixture({headerHeight:56,clientWidth:800,clientHeight:1000});
  f.sizeButton.setAttribute('data-title-no-tooltip','Default view');f.settings(true);
  const dimensions=()=>({player:parseFloat(f.watch.style.getPropertyValue('--ytlp-player-height')),chat:parseFloat(f.watch.style.getPropertyValue('--ytlp-chat-height'))});
  const compact=dimensions();assert.deepEqual(compact,{player:450,chat:440});
  assert.equal(f.nativeResizeCount(),1);
  for(let index=0;index<12;index++){
    f.resizeInfo(220);
    const expanded=dimensions();
    assert.deepEqual(expanded,{player:354,chat:416});
    assert.ok(expanded.player<compact.player);assert.ok(expanded.chat<compact.chat);
    assert.equal(f.nativeResizeCount(),1);
    f.event('yt-player-updated');assert.equal(f.nativeResizeCount(),1);
    f.resizeInfo(100);assert.deepEqual(dimensions(),compact);assert.equal(f.nativeResizeCount(),1);
  }
  assert.equal(f.headerMeasureCount(),1);
});

test('hover-like class and layout mutations do not issue synthetic viewport events', () => {
  const f=fixture({headerHeight:56,clientWidth:800,clientHeight:1000});
  f.sizeButton.setAttribute('data-title-no-tooltip','Default view');f.settings(true);
  for(let index=0;index<10;index++){
    f.mutate(f.player,'class',index%2?'html5-video-player ytp-live ytp-autohide':'html5-video-player ytp-live');
    f.watch.rect.width=index%2?792:800;f.event('yt-player-updated');
    assert.equal(f.nativeResizeCount(),1);
  }
  f.doc.documentElement.clientWidth=790;f.event('resize');assert.equal(f.nativeResizeCount(),2);
  f.doc.documentElement.clientHeight=980;f.event('resize');assert.equal(f.nativeResizeCount(),3);
  for(let index=0;index<5;index++)f.event('yt-player-updated');
  assert.equal(f.nativeResizeCount(),3);
});

test('wide theater places recommendations after the metadata wrapper and preserves all media/native sizing', () => {
  const f=fixture({headerHeight:56,metadataWrapper:true,chatInBelow:true,clientWidth:1400,clientHeight:900});
  f.player.style.setProperty('width','1337px');f.chat.style.setProperty('height','480px');
  const stable=[f.video,f.playerHost,f.player,f.chat,f.iframe,f.title,f.infoBox].map(node=>[node,node.parentNode,node.moves]);
  const frameSource=f.iframe.getAttribute('src');
  f.sizeButton.setAttribute('data-title-no-tooltip','Default view');f.settings(true);
  assert.equal(f.status().mode,'landscape-theater');assert.equal(f.status().reason,'landscape-theater');assert.equal(f.status().active,true);
  assert.equal(f.status().version,manifest.version);assert.equal(f.watch.getAttribute('data-ytlp-version'),manifest.version);
  assert.equal(f.infoBox.nextSibling,f.related);assert.equal(f.related.parentNode,f.below);assert.equal(f.related.getAttribute('data-ytlp-part'),'recommendations');
  assert.equal(f.related.nextSibling,f.comments);
  assert.equal(f.doc.documentElement.hasAttribute('data-ytlp-portrait'),false);assert.equal(f.headerMeasureCount(),0);
  assert.equal(f.watch.style.css.size,0);assert.equal(f.player.style.getPropertyValue('width'),'1337px');assert.equal(f.chat.style.getPropertyValue('height'),'480px');
  for(const node of [f.chat,f.playerHost,f.infoBox,f.title])assert.equal(node.hasAttribute('data-ytlp-part'),false);
  assert.equal(f.below.hasAttribute('data-ytlp-flow'),false);assert.equal(f.iframe.getAttribute('src'),frameSource);
  for(const [node,parent,moves] of stable){assert.equal(node.parentNode,parent);assert.equal(node.moves,moves);}
  assert.equal(f.nativeResizeCount(),0);
});

test('portrait rotation restores native layout for two frames before wide theater recommendations activate', () => {
  const f=fixture({headerHeight:56,clientWidth:800,clientHeight:1000});
  const stable=[f.video,f.playerHost,f.chat,f.iframe].map(node=>[node,node.parentNode,node.moves]);
  f.sizeButton.setAttribute('data-title-no-tooltip','Default view');f.settings(true);
  const beforeExit=f.nativeResizeCount();
  f.doc.documentElement.clientWidth=1400;f.doc.fire('window:resize');f.frame();
  assert.equal(f.status().active,false);assert.equal(f.status().mode,null);
  assert.equal(f.related.parentNode,f.home);assert.equal(f.title.parentNode,f.titleParent);
  assert.equal(f.doc.documentElement.hasAttribute('data-ytlp-portrait'),false);assert.equal(f.watch.style.css.size,0);
  assert.equal(f.nativeResizeCount(),beforeExit);
  f.frame();assert.equal(f.nativeResizeCount(),beforeExit);
  f.frame();assert.equal(f.nativeResizeCount(),beforeExit+1);
  f.flush();assert.equal(f.status().mode,'landscape-theater');assert.equal(f.metadata.nextSibling,f.related);
  assert.equal(f.watch.style.css.size,0);assert.ok(f.resizeObservers.every(observer=>observer.targets.size===0));
  for(let index=0;index<4;index++)f.event('resize');assert.equal(f.nativeResizeCount(),beforeExit+1);
  f.doc.documentElement.clientWidth=800;f.event('resize');
  assert.equal(f.status().mode,'portrait-theater');assert.equal(f.related.parentNode,f.watch);
  assert.equal(f.doc.documentElement.hasAttribute('data-ytlp-portrait'),true);assert.equal(f.title.parentNode,f.ownerRenderer);
  for(const [node,parent,moves] of stable){assert.equal(node.parentNode,parent);assert.equal(node.moves,moves);}
});

test('short wide theater viewports outside the allowance use recommendation mode rather than portrait fallback', () => {
  for(const [width,height] of [[1000,400],[900,600]]){
    const f=fixture({headerHeight:56,clientWidth:width,clientHeight:height});
    f.sizeButton.setAttribute('data-title-no-tooltip','Default view');f.settings(true);
    assert.equal(f.status().mode,'landscape-theater');assert.equal(f.metadata.nextSibling,f.related);
    assert.equal(f.watch.style.css.size,0);assert.equal(f.doc.documentElement.hasAttribute('data-ytlp-portrait'),false);
    assert.equal(f.title.parentNode,f.titleParent);assert.equal(f.nativeResizeCount(),0);
  }
});

test('theater accepts a square, the observed floating window and the inclusive 3 percent width boundary', () => {
  for(const [width,height] of [[1000,1000],[1255,1246],[1030,1000]]){
    const f=fixture({headerHeight:56,clientWidth:width,clientHeight:height});
    f.sizeButton.setAttribute('data-title-no-tooltip','Default view');f.settings(true);
    assert.equal(f.status().mode,'portrait-theater',`${width}x${height}`);
    assert.equal(f.watch.getAttribute('data-ytlp-orientation'),'portrait');
    assert.equal(f.doc.documentElement.hasAttribute('data-ytlp-portrait'),true);
    assert.equal(f.title.parentNode,f.ownerRenderer);assert.equal(f.related.parentNode,f.watch);
    assert.ok(parseFloat(f.watch.style.getPropertyValue('--ytlp-chat-height'))>=360);
    assert.equal(f.nativeResizeCount(),1);
  }
});

test('one pixel beyond the 3 percent width boundary retains landscape theater', () => {
  const f=fixture({headerHeight:56,clientWidth:1031,clientHeight:1000});
  f.sizeButton.setAttribute('data-title-no-tooltip','Default view');f.settings(true);
  assert.equal(f.status().mode,'landscape-theater');assert.equal(f.metadata.nextSibling,f.related);
  assert.equal(f.watch.getAttribute('data-ytlp-orientation'),'landscape');
  assert.equal(f.doc.documentElement.hasAttribute('data-ytlp-portrait'),false);
  assert.equal(f.title.parentNode,f.titleParent);assert.equal(f.watch.style.css.size,0);
  assert.equal(f.nativeResizeCount(),0);
});

test('resizing across the 3 percent boundary switches both ways without moving media', () => {
  const f=fixture({headerHeight:56,clientWidth:1030,clientHeight:1000});
  const media=[f.playerHost,f.player,f.video,f.chat,f.iframe].map(node=>[node,node.parentNode,node.moves]);
  f.sizeButton.setAttribute('data-title-no-tooltip','Default view');f.settings(true);
  assert.equal(f.status().mode,'portrait-theater');
  for(let cycle=0;cycle<2;cycle++){
    f.doc.documentElement.clientWidth=1031;f.event('resize');
    assert.equal(f.status().mode,'landscape-theater');assert.equal(f.metadata.nextSibling,f.related);
    assert.equal(f.doc.documentElement.hasAttribute('data-ytlp-portrait'),false);
    assert.equal(f.title.parentNode,f.titleParent);assert.equal(f.watch.style.css.size,0);
    f.doc.documentElement.clientWidth=1030;f.event('resize');
    assert.equal(f.status().mode,'portrait-theater');assert.equal(f.related.parentNode,f.watch);
    assert.equal(f.doc.documentElement.hasAttribute('data-ytlp-portrait'),true);
    assert.equal(f.title.parentNode,f.ownerRenderer);
  }
  // Each return to portrait needs one restored-native measurement and one
  // measurement after applying its player sizing, in addition to each exit.
  assert.equal(f.nativeResizeCount(),7);
  for(const [node,parent,moves]of media){assert.equal(node.parentNode,parent);assert.equal(node.moves,moves);}
});

test('normal mode updates recommendation orientation at the 3 percent boundary without changing native media or metadata', () => {
  const f=fixture({headerHeight:56,clientWidth:1255,clientHeight:1246});f.settings(true);
  const media=[f.playerHost,f.player,f.video,f.chat,f.iframe].map(node=>[node,node.parentNode,node.moves]);
  for(const [width,height,orientation]of [[1255,1246,'portrait'],[1030,1000,'portrait'],[1031,1000,'landscape'],[1000,1000,'portrait'],[1400,900,'landscape']]){
    f.doc.documentElement.clientWidth=width;f.doc.documentElement.clientHeight=height;f.event('resize');
    assert.equal(f.status().mode,'normal');assert.equal(f.metadata.nextSibling,f.related);
    assert.equal(f.watch.getAttribute('data-ytlp-orientation'),orientation,`${width}x${height}`);
    assert.equal(f.watch.style.getPropertyValue('--ytlp-chat-height'),`${height-12-f.chat.rect.top}px`);
    assert.equal(f.title.parentNode,f.titleParent);assert.equal(f.playerHost.hasAttribute('data-ytlp-part'),false);
    assert.equal(f.doc.documentElement.hasAttribute('data-ytlp-portrait'),false);
    assert.equal(f.nativeResizeCount(),0);
    for(const [node,parent,moves]of media){assert.equal(node.parentNode,parent);assert.equal(node.moves,moves);}
  }
});

test('OFF, fullscreen and SPA remove recommendation orientation for every active layout mode', () => {
  for(const mode of ['normal','portrait-theater','landscape-theater']){
    for(const exit of ['off','fullscreen','spa']){
      const f=fixture({clientWidth:mode==='portrait-theater'?800:1400,clientHeight:1000});
      if(mode!=='normal')f.sizeButton.setAttribute('data-title-no-tooltip','Default view');
      f.settings(true);assert.equal(f.status().mode,mode);assert.equal(f.watch.hasAttribute('data-ytlp-orientation'),true);
      if(exit==='off')f.changeEnabled(false);
      if(exit==='fullscreen'){f.doc.fullscreenElement=f.player;f.event('fullscreenchange');}
      if(exit==='spa')f.event('yt-navigate-start');
      assert.equal(f.status().active,false,`${mode}: ${exit}`);
      assert.equal(f.watch.hasAttribute('data-ytlp-orientation'),false,`${mode}: ${exit}`);
      assert.equal(f.related.parentNode,f.home);
    }
  }
});

test('square and near-square theater windows still honor the minimum usable height', () => {
  for(const [width,height]of [[400,400],[513,499]]){
    const f=fixture({headerHeight:56,clientWidth:width,clientHeight:height});
    f.sizeButton.setAttribute('data-title-no-tooltip','Default view');f.settings(true);
    assert.equal(f.status().reason,'viewport-small');assert.equal(f.status().active,false);
    assert.equal(f.related.parentNode,f.home);assert.equal(f.title.parentNode,f.titleParent);
    assert.equal(f.doc.documentElement.hasAttribute('data-ytlp-portrait'),false);
    assert.equal(f.watch.style.css.size,0);assert.equal(f.nativeResizeCount(),0);
  }
});

test('wide theater fullscreen/OFF/SPA transitions restore the original recommendation slot', () => {
  const f=fixture({clientWidth:1400,clientHeight:900});
  f.sizeButton.setAttribute('data-title-no-tooltip','Default view');f.settings(true);
  assert.equal(f.metadata.nextSibling,f.related);
  f.doc.fullscreenElement=f.player;f.event('fullscreenchange');
  assert.equal(f.status().reason,'fullscreen');assert.equal(f.related.parentNode,f.home);
  f.doc.fullscreenElement=null;f.event('fullscreenchange');assert.equal(f.status().mode,'landscape-theater');
  f.changeEnabled(false);assert.equal(f.related.parentNode,f.home);assert.equal(f.related.hasAttribute('data-ytlp-part'),false);
  f.changeEnabled(true);assert.equal(f.metadata.nextSibling,f.related);
  f.event('yt-navigate-start');assert.equal(f.related.parentNode,f.home);assert.equal(f.status().active,false);
  f.event('yt-navigate-finish');assert.equal(f.status().mode,'landscape-theater');assert.equal(f.metadata.nextSibling,f.related);
  assert.equal(f.nativeResizeCount(),0);assert.equal(f.watch.style.css.size,0);
});

test('switching between normal and wide theater clears chat overrides and measures each restored layout once', () => {
  const f=fixture({clientWidth:1400,clientHeight:900});f.settings(true);
  assert.equal(f.status().mode,'normal');assert.equal(f.watch.style.getPropertyValue('--ytlp-chat-height'),'788px');
  f.mutate(f.sizeButton,'data-title-no-tooltip','Default view');
  assert.equal(f.status().mode,'landscape-theater');assert.equal(f.watch.style.getPropertyValue('--ytlp-chat-height'),'');
  assert.equal(f.chat.hasAttribute('data-ytlp-part'),false);assert.equal(f.metadata.nextSibling,f.related);
  f.mutate(f.sizeButton,'data-title-no-tooltip','Theater mode');
  assert.equal(f.status().mode,'normal');assert.equal(f.watch.style.getPropertyValue('--ytlp-chat-height'),'788px');
  assert.equal(f.chat.getAttribute('data-ytlp-part'),'chat');assert.equal(f.metadata.nextSibling,f.related);
  assert.equal(f.nativeResizeCount(),2);
});

test('wide theater button capture restores the secondary column before native player resize', () => {
  const f=fixture({secondaryInner:true,chatInBelow:true,clientWidth:1400,clientHeight:900});
  const stable=[f.playerHost,f.player,f.video,f.chat,f.iframe].map(node=>[node,node.parentNode,node.moves]);
  f.player.style.setProperty('width','1234px');
  f.sizeButton.setAttribute('data-title-no-tooltip','Default view');f.settings(true);
  assert.equal(f.secondary.getAttribute('data-ytlp-part'),'empty-column');
  const measurements=[];
  f.global.addEventListener('resize',()=>measurements.push({active:f.status().active,collapsed:f.secondary.hasAttribute('data-ytlp-part'),relatedHome:f.related.parentNode===f.home}));
  f.doc.fire('click',{target:f.sizeButton});
  assert.equal(f.status().active,false);assert.equal(f.secondary.hasAttribute('data-ytlp-part'),false);
  assert.equal(f.related.parentNode,f.home);assert.equal(f.player.style.getPropertyValue('width'),'1234px');
  f.sizeButton.setAttribute('data-title-no-tooltip','Theater mode');
  f.frame();assert.equal(f.nativeResizeCount(),0);
  f.frame();assert.equal(f.nativeResizeCount(),1);
  assert.deepEqual(measurements,[{active:false,collapsed:false,relatedHome:true}]);
  f.flush();assert.equal(f.status().mode,'normal');assert.equal(f.chat.getAttribute('data-ytlp-part'),'chat');
  assert.equal(f.metadata.nextSibling,f.related);assert.equal(f.secondary.hasAttribute('data-ytlp-part'),false);
  for(let index=0;index<6;index++)f.event('yt-player-updated');
  assert.equal(f.nativeResizeCount(),1);
  for(const [node,parent,moves]of stable){assert.equal(node.parentNode,parent);assert.equal(node.moves,moves);}
});

test('wide theater attribute-only transition waits two frames with all overrides removed', () => {
  const f=fixture({secondaryInner:true,chatInBelow:true,clientWidth:1400,clientHeight:900});
  f.sizeButton.setAttribute('data-title-no-tooltip','Default view');f.settings(true);
  f.sizeButton.setAttribute('data-title-no-tooltip','Theater mode');f.doc.fire('yt-player-updated');f.frame();
  assert.equal(f.status().active,false);assert.equal(f.status().mode,null);
  assert.equal(f.secondary.hasAttribute('data-ytlp-part'),false);assert.equal(f.related.parentNode,f.home);
  assert.equal(f.watch.style.css.size,0);assert.equal(f.nativeResizeCount(),0);
  f.frame();assert.equal(f.nativeResizeCount(),0);
  f.frame();assert.equal(f.nativeResizeCount(),1);assert.equal(f.status().active,false);
  f.flush();assert.equal(f.status().mode,'normal');assert.equal(f.metadata.nextSibling,f.related);
  for(let index=0;index<6;index++)f.event('resize');
  assert.equal(f.nativeResizeCount(),1);
});

test('wide theater keyboard capture ignores editing and coalesces duplicate mode controls while settling', () => {
  const f=fixture({secondaryInner:true,chatInBelow:true,clientWidth:1400,clientHeight:900});
  f.sizeButton.setAttribute('data-title-no-tooltip','Default view');f.settings(true);
  const input=f.below.appendChild(new Element('input'));
  const editable=f.below.appendChild(new Element('div',{contenteditable:'true'}));
  f.doc.fire('keydown',{target:input,key:'t'});f.doc.fire('keydown',{target:editable,key:'t'});
  f.doc.fire('keydown',{target:f.video,key:'t',ctrlKey:true});
  assert.equal(f.status().mode,'landscape-theater');assert.equal(f.nativeResizeCount(),0);
  f.doc.fire('keydown',{target:f.video,key:'t'});
  assert.equal(f.status().active,false);assert.equal(f.secondary.hasAttribute('data-ytlp-part'),false);
  f.doc.fire('click',{target:f.sizeButton});f.doc.fire('keydown',{target:f.video,key:'t'});
  f.sizeButton.setAttribute('data-title-no-tooltip','Theater mode');f.flush();
  assert.equal(f.status().mode,'normal');assert.equal(f.nativeResizeCount(),1);
  f.event('resize');assert.equal(f.nativeResizeCount(),1);
});

test('normal button capture releases its chat override before entering wide theater', () => {
  const f=fixture({secondaryInner:true,chatInBelow:true,clientWidth:1400,clientHeight:900});f.settings(true);
  assert.equal(f.status().mode,'normal');assert.equal(f.watch.style.getPropertyValue('--ytlp-chat-height'),'788px');
  f.doc.fire('click',{target:f.sizeButton});
  assert.equal(f.status().active,false);assert.equal(f.watch.style.css.size,0);
  assert.equal(f.chat.hasAttribute('data-ytlp-part'),false);assert.equal(f.related.parentNode,f.home);
  f.sizeButton.setAttribute('data-title-no-tooltip','Default view');f.flush();
  assert.equal(f.status().mode,'landscape-theater');assert.equal(f.nativeResizeCount(),1);
  assert.equal(f.secondary.getAttribute('data-ytlp-part'),'empty-column');
  for(let index=0;index<6;index++)f.event('yt-player-updated');assert.equal(f.nativeResizeCount(),1);
});

test('wide theater reorders existing below recommendations and restores their precise former order', () => {
  const f=fixture({relatedAlreadyBelow:true,metadataWrapper:true,clientWidth:1400,clientHeight:900});
  assert.equal(f.comments.nextSibling,f.related);
  f.sizeButton.setAttribute('data-title-no-tooltip','Default view');f.settings(true);
  assert.equal(f.infoBox.nextSibling,f.related);assert.equal(f.related.nextSibling,f.comments);
  f.changeEnabled(false);assert.equal(f.comments.nextSibling,f.related);
  assert.equal(f.title.parentNode,f.titleParent);
});

test('wide fixed-chat layout collapses only the now-empty secondary column after recommendations move', () => {
  const f=fixture({secondaryInner:true,chatInBelow:true,clientWidth:2552,clientHeight:1271});
  for(const id of ['panels','playlist','inline-panels','persistent-panel-container','donation-shelf']){
    const child=f.secondaryInner.appendChild(new Element('div',{id}));child.rect.height=0;
    if(id==='playlist'){child.setAttribute('hidden','');child.rect.height=200;}
  }
  const stable=[f.video,f.playerHost,f.chat,f.iframe].map(node=>[node,node.parentNode,node.moves]);
  f.secondary.style.setProperty('width','709.55px');
  f.sizeButton.setAttribute('data-title-no-tooltip','Default view');f.settings(true);
  assert.equal(f.status().mode,'landscape-theater');assert.equal(f.metadata.nextSibling,f.related);
  assert.equal(f.secondary.getAttribute('data-ytlp-part'),'empty-column');
  assert.equal(f.secondary.style.getPropertyValue('width'),'709.55px');
  assert.equal(f.secondaryInner.children.some(node=>node.name==='#comment'),false);
  assert.equal(f.secondaryInner.childNodes.some(node=>node.name==='#comment'),true);
  assert.equal(f.watch.style.css.size,0);assert.equal(f.nativeResizeCount(),0);
  for(const [node,parent,moves]of stable){assert.equal(node.parentNode,parent);assert.equal(node.moves,moves);}
});

test('a newly visible native secondary panel restores column sizing and can later collapse again', () => {
  const f=fixture({secondaryInner:true,chatInBelow:true,clientWidth:1400,clientHeight:900});
  const panel=f.secondaryInner.appendChild(new Element('div',{id:'panels'}));panel.rect.height=0;
  f.sizeButton.setAttribute('data-title-no-tooltip','Default view');f.settings(true);
  assert.equal(f.secondary.getAttribute('data-ytlp-part'),'empty-column');
  panel.rect.height=200;f.event('yt-page-data-updated');
  assert.equal(f.secondary.hasAttribute('data-ytlp-part'),false);assert.equal(f.status().mode,'landscape-theater');
  f.mutate(panel,'hidden','');assert.equal(f.secondary.getAttribute('data-ytlp-part'),'empty-column');
  f.mutate(panel,'hidden',null);assert.equal(f.secondary.hasAttribute('data-ytlp-part'),false);
  panel.rect.height=0;f.event('yt-page-data-updated');assert.equal(f.secondary.getAttribute('data-ytlp-part'),'empty-column');
  assert.equal(f.metadata.nextSibling,f.related);assert.equal(f.nativeResizeCount(),0);
});

test('a secondary column containing chat or video is never collapsed even with an empty inner container', () => {
  const withChat=fixture({secondaryInner:true,clientWidth:1400,clientHeight:900});
  withChat.sizeButton.setAttribute('data-title-no-tooltip','Default view');withChat.settings(true);
  assert.equal(withChat.secondary.contains(withChat.chat),true);assert.equal(withChat.secondary.hasAttribute('data-ytlp-part'),false);
  const withVideo=fixture({secondaryInner:true,chatInBelow:true,clientWidth:1400,clientHeight:900});
  withVideo.secondary.appendChild(withVideo.playerHost);const initialMoves=withVideo.playerHost.moves;
  withVideo.sizeButton.setAttribute('data-title-no-tooltip','Default view');withVideo.settings(true);
  assert.equal(withVideo.status().mode,'landscape-theater');assert.equal(withVideo.secondary.hasAttribute('data-ytlp-part'),false);
  assert.equal(withVideo.playerHost.moves,initialMoves);assert.equal(withVideo.playerHost.parentNode,withVideo.secondary);
});

test('unknown secondary structure without secondary-inner keeps native column sizing', () => {
  const f=fixture({chatInBelow:true,clientWidth:1400,clientHeight:900});
  const panel=f.secondary.appendChild(new Element('div',{id:'panels'}));panel.rect.height=0;
  f.sizeButton.setAttribute('data-title-no-tooltip','Default view');f.settings(true);
  assert.equal(f.status().mode,'landscape-theater');assert.equal(f.secondary.hasAttribute('data-ytlp-part'),false);
  assert.equal(f.metadata.nextSibling,f.related);
});

test('OFF, normal and portrait transitions remove the empty-secondary-column tag', () => {
  for(const exit of ['off','normal','portrait']){
    const f=fixture({secondaryInner:true,chatInBelow:true,clientWidth:1400,clientHeight:900});
    f.sizeButton.setAttribute('data-title-no-tooltip','Default view');f.settings(true);
    assert.equal(f.secondary.getAttribute('data-ytlp-part'),'empty-column');
    if(exit==='off')f.changeEnabled(false);
    if(exit==='normal')f.mutate(f.sizeButton,'data-title-no-tooltip','Theater mode');
    if(exit==='portrait'){f.doc.documentElement.clientWidth=800;f.doc.documentElement.clientHeight=1000;f.event('resize');}
    assert.notEqual(f.secondary.getAttribute('data-ytlp-part'),'empty-column',exit);
    if(exit==='off')assert.equal(f.related.parentNode,f.secondaryInner);
    if(exit==='normal')assert.equal(f.status().mode,'normal');
    if(exit==='portrait')assert.equal(f.status().mode,'portrait-theater');
  }
});

test('native chat relocation into a previously empty secondary removes its collapse tag', () => {
  const f=fixture({secondaryInner:true,chatInBelow:true,clientWidth:1400,clientHeight:900});
  f.sizeButton.setAttribute('data-title-no-tooltip','Default view');f.settings(true);
  assert.equal(f.secondary.getAttribute('data-ytlp-part'),'empty-column');
  f.secondary.appendChild(f.chat);const nativeMoves=f.chat.moves,frameMoves=f.iframe.moves;
  f.event('yt-page-data-updated');
  assert.equal(f.secondary.hasAttribute('data-ytlp-part'),false);assert.equal(f.chat.parentNode,f.secondary);
  assert.equal(f.chat.moves,nativeMoves);assert.equal(f.iframe.moves,frameMoves);
});

test('normal chat follows its original secondary host in both viewport orientations without moving media', () => {
  for(const [width,height]of [[1400,900],[800,1000]]){
    const f=fixture({headerHeight:56,secondaryInner:true,chatInSecondaryInner:true,clientWidth:width,clientHeight:height});
    const stable=[f.playerHost,f.player,f.video,f.chat.parentNode,f.chat,f.iframe].map(node=>[node,node.parentNode,node.moves]);
    f.settings(true);
    assert.equal(f.status().mode,'normal');assert.equal(f.secondaryInner.getAttribute('data-ytlp-part'),'sticky-chat-host');
    assert.equal(f.watch.style.getPropertyValue('--ytlp-chat-sticky-top'),'56px');
    assert.equal(f.watch.style.getPropertyValue('--ytlp-chat-height'),`${height-112}px`);
    assert.equal(f.nativeResizeCount(),0);
    for(const [node,parent,moves]of stable){assert.equal(node.parentNode,parent);assert.equal(node.moves,moves);}
  }
});

test('normal scrolling fills the viewport below the sticky header and never grows at the column bottom', () => {
  const f=fixture({headerHeight:56,secondaryInner:true,chatInSecondaryInner:true,clientWidth:1400,clientHeight:1000});
  f.settings(true);
  for(const [chatTop,height]of [[300,688],[100,888],[56,932],[40,932],[-20,932],[40,932],[56,932],[300,688]]){
    f.chat.rect.top=chatTop;f.event('scroll');
    assert.equal(f.watch.style.getPropertyValue('--ytlp-chat-height'),`${height}px`,`chat top ${chatTop}`);
    assert.equal(f.watch.style.getPropertyValue('--ytlp-chat-sticky-top'),'56px');
  }
  f.chat.rect.top=40;
  for(let index=0;index<12;index++){f.event('scroll');assert.equal(f.watch.style.getPropertyValue('--ytlp-chat-height'),'932px');}
  f.doc.documentElement.clientHeight=400;f.event('resize');
  assert.equal(f.watch.style.getPropertyValue('--ytlp-chat-height'),'360px');
  assert.equal(f.nativeResizeCount(),0);
});

test('the stretched secondary bottom limits sticky chat height at the page end in both orientations', () => {
  for(const [width,height]of [[1400,900],[800,1271]]){
    const f=fixture({headerHeight:56,secondaryInner:true,chatInSecondaryInner:true,clientWidth:width,clientHeight:height});
    f.settings(true);f.chat.rect.top=56;f.event('scroll');
    assert.equal(f.watch.style.getPropertyValue('--ytlp-chat-height'),`${height-68}px`);
    // At the document end, 24px of outer page spacing puts the containing
    // column's bottom above the viewport. The old height would put chat at 32px.
    f.secondary.rect.top=-1000;f.secondary.rect.height=1000+height-24;
    f.chat.rect.top=32;
    // Deliberately unrelated host geometry catches accidental self-measurement.
    f.secondaryInner.rect.height=70;
    f.event('scroll');
    assert.equal(f.watch.style.getPropertyValue('--ytlp-chat-height'),`${height-80}px`);
    assert.equal(f.watch.style.getPropertyValue('--ytlp-chat-sticky-top'),'56px');
    assert.equal(56+parseFloat(f.watch.style.getPropertyValue('--ytlp-chat-height')),height-24);
    // After the browser can put the resized host back below the header, repeat
    // reconciliation must keep that height stable instead of creating a loop.
    f.chat.rect.top=56;
    for(let index=0;index<8;index++){f.event('scroll');assert.equal(f.watch.style.getPropertyValue('--ytlp-chat-height'),`${height-80}px`);}
    f.secondary.rect.height=5000;f.event('scroll');
    assert.equal(f.watch.style.getPropertyValue('--ytlp-chat-height'),`${height-68}px`);
    assert.equal(f.nativeResizeCount(),0);
  }
});

test('sticky host wrappers outside the secondary column do not constrain chat to their own bottom', () => {
  const f=fixture({headerHeight:56,secondaryInner:true,chatInSecondaryInner:true,clientWidth:1400,clientHeight:1000});
  const wrapper=f.secondary.appendChild(new Element('div',{id:'native-wrapper'}));
  wrapper.rect.height=20;wrapper.appendChild(f.secondaryInner);
  f.chat.rect.top=56;f.settings(true);
  assert.equal(f.secondaryInner.getAttribute('data-ytlp-part'),'sticky-chat-host');
  assert.equal(f.watch.style.getPropertyValue('--ytlp-chat-height'),'932px');
});

test('sticky chat uses the visible header bottom with a safe zero offset when no header is visible', () => {
  for(const kind of ['missing','hidden','zero-height','above-viewport','below-viewport','container-only']){
    const f=fixture({headerHeight:kind==='missing'?undefined:64,containerOnly:kind==='container-only',secondaryInner:true,chatInSecondaryInner:true,clientWidth:1400,clientHeight:1000});
    if(kind==='hidden')f.masthead.hidden=true;
    if(kind==='zero-height')f.masthead.rect.height=0;
    if(kind==='above-viewport')f.masthead.rect.top=-100;
    if(kind==='below-viewport')f.masthead.rect.top=1001;
    f.chat.rect.top=-20;f.settings(true);
    const expectedTop=kind==='container-only'?64:0;
    assert.equal(f.watch.style.getPropertyValue('--ytlp-chat-sticky-top'),`${expectedTop}px`,kind);
    assert.equal(f.watch.style.getPropertyValue('--ytlp-chat-height'),`${988-expectedTop}px`,kind);
  }
});

test('native fixed chat or video inside the secondary host prevents sticky overrides and clears stale ones', () => {
  for(const target of ['chat-elsewhere','video-inside']){
    const f=fixture({headerHeight:56,secondaryInner:true,chatInSecondaryInner:true,clientWidth:1400,clientHeight:1000});
    f.settings(true);assert.equal(f.secondaryInner.getAttribute('data-ytlp-part'),'sticky-chat-host');
    if(target==='chat-elsewhere')f.secondary.appendChild(f.chat);
    else f.secondaryInner.appendChild(f.playerHost);
    const stable=[f.playerHost,f.video,f.chat,f.iframe].map(node=>[node,node.parentNode,node.moves]);
    f.chat.rect.top=40;f.event('yt-player-updated');
    assert.equal(f.status().mode,'normal');assert.equal(f.secondaryInner.hasAttribute('data-ytlp-part'),false,target);
    assert.equal(f.watch.style.getPropertyValue('--ytlp-chat-sticky-top'),'',target);
    assert.equal(f.watch.style.getPropertyValue('--ytlp-chat-height'),'948px',target);
    for(const [node,parent,moves]of stable){assert.equal(node.parentNode,parent);assert.equal(node.moves,moves);}
  }
  const f=fixture({chatInBelow:true,clientWidth:1400,clientHeight:1000});f.settings(true);
  assert.equal(f.watch.style.getPropertyValue('--ytlp-chat-sticky-top'),'');
});

test('leaving normal mode removes sticky host tags and offsets before any new layout applies', () => {
  for(const exit of ['off','fullscreen','spa','wide-theater','portrait-theater']){
    const f=fixture({headerHeight:56,secondaryInner:true,chatInSecondaryInner:true,clientWidth:1400,clientHeight:1000});
    f.settings(true);assert.equal(f.secondaryInner.getAttribute('data-ytlp-part'),'sticky-chat-host');
    if(exit==='off')f.changeEnabled(false);
    if(exit==='fullscreen'){f.doc.fullscreenElement=f.player;f.event('fullscreenchange');}
    if(exit==='spa')f.event('yt-navigate-start');
    if(exit.endsWith('theater')){
      if(exit==='portrait-theater')f.doc.documentElement.clientWidth=800;
      f.doc.fire('click',{target:f.sizeButton});
      assert.equal(f.secondaryInner.hasAttribute('data-ytlp-part'),false);
      assert.equal(f.watch.style.getPropertyValue('--ytlp-chat-sticky-top'),'');
      f.sizeButton.setAttribute('data-title-no-tooltip','Default view');f.flush();
    }
    assert.notEqual(f.secondaryInner.getAttribute('data-ytlp-part'),'sticky-chat-host',exit);
    assert.equal(f.watch.style.getPropertyValue('--ytlp-chat-sticky-top'),'',exit);
    if(exit.endsWith('theater')){
      f.mutate(f.sizeButton,'data-title-no-tooltip','Theater mode');
      assert.equal(f.secondaryInner.getAttribute('data-ytlp-part'),'sticky-chat-host');
      assert.equal(f.watch.style.getPropertyValue('--ytlp-chat-sticky-top'),'56px');
    }
  }
});

test('normal chat reserves exactly 12px below its viewport height in both orientations and native placements', () => {
  for(const [width,height]of [[1400,900],[800,1271]]){
    for(const sticky of [false,true]){
      const f=fixture({headerHeight:56,secondaryInner:sticky,chatInSecondaryInner:sticky,clientWidth:width,clientHeight:height});
      f.settings(true);
      const chatHeight=()=>parseFloat(f.watch.style.getPropertyValue('--ytlp-chat-height'));
      assert.equal(height-f.chat.rect.top-chatHeight(),12);
      f.chat.rect.top=56;f.event('scroll');assert.equal(height-56-chatHeight(),12);
      f.doc.documentElement.clientHeight=height+100;f.event('resize');
      assert.equal(height+100-56-chatHeight(),12);
    }
  }
});

test('portrait theater fills to the viewport bottom while metadata expansion redistributes player and chat space', () => {
  for(const [width,height]of [[800,1000],[600,800]]){
    const f=fixture({headerHeight:56,clientWidth:width,clientHeight:height});
    f.watch.rect.width=width;f.sizeButton.setAttribute('data-title-no-tooltip','Default view');f.settings(true);
    const value=name=>parseFloat(f.watch.style.getPropertyValue(`--ytlp-${name}`));
    for(const infoHeight of [100,180,100]){
      f.resizeInfo(infoHeight);
      const bottom=f.watch.getBoundingClientRect().top+value('player-height')+infoHeight+10+value('chat-height');
      assert.equal(height-bottom,0);
      assert.ok(value('chat-height')>=360);
    }
    assert.equal(f.nativeResizeCount(),1);
  }
});

test('steady normal scrolling uses cached geometry without selector queries or redundant attribute writes', () => {
  const f=fixture({headerHeight:56,secondaryInner:true,chatInSecondaryInner:true,clientWidth:1400,clientHeight:1000});
  f.settings(true);f.resetOperations();
  for(let index=0;index<120;index++){
    f.chat.rect.top=index%2?56:80;f.event('scroll');
    assert.equal(f.watch.style.getPropertyValue('--ytlp-chat-height'),index%2?'932px':'908px');
  }
  assert.deepEqual(f.operations(),{queries:0,rectReads:360,attributeWrites:0,styleWrites:120,queuedFrames:120});
  f.resetOperations();f.event('scroll');
  assert.equal(f.operations().styleWrites,0);assert.equal(f.operations().queries,0);
});

test('scroll bursts coalesce while full DOM updates win in either event order', () => {
  for(const fullFirst of [false,true]){
    const f=fixture({clientWidth:1400,clientHeight:1000});f.settings(true);f.resetOperations();
    const fullUpdate=()=>{
      f.sizeButton.setAttribute('data-title-no-tooltip','Default view');
      for(const observer of f.mutationObservers)observer.callback([{type:'attributes',target:f.sizeButton,attributeName:'data-title-no-tooltip'}]);
    };
    if(fullFirst)fullUpdate();
    for(let index=0;index<20;index++)f.doc.fire('window:scroll');
    if(!fullFirst)fullUpdate();
    assert.equal(f.operations().queuedFrames,1);f.flush();
    assert.equal(f.status().mode,'landscape-theater');assert.ok(f.operations().queries>0);
    assert.equal(f.nativeResizeCount(),1);
  }
});

test('scroll cache falls back when a native chat move invalidates its parent', () => {
  const f=fixture({headerHeight:56,secondaryInner:true,chatInSecondaryInner:true,clientWidth:1400,clientHeight:1000});
  f.settings(true);f.secondary.appendChild(f.chat);f.chat.rect.top=40;f.resetOperations();
  const nativeMoves=f.chat.moves,frameMoves=f.iframe.moves;
  f.event('scroll');assert.ok(f.operations().queries>0);
  assert.equal(f.secondaryInner.hasAttribute('data-ytlp-part'),false);
  assert.equal(f.watch.style.getPropertyValue('--ytlp-chat-sticky-top'),'');
  assert.equal(f.watch.style.getPropertyValue('--ytlp-chat-height'),'948px');
  assert.equal(f.chat.moves,nativeMoves);assert.equal(f.iframe.moves,frameMoves);
  f.resetOperations();f.event('scroll');assert.equal(f.operations().queries,0);
});

test('a replaced chat frame invalidates cached scrolling and late recovery still finds its replacement', () => {
  const f=fixture({clientWidth:1400,clientHeight:1000});f.settings(true);
  f.iframe.remove();f.resetOperations();f.event('scroll');
  assert.ok(f.operations().queries>0);assert.equal(f.status().reason,'no-chat');assert.equal(f.status().active,false);
  const replacement=f.chat.appendChild(new Element('iframe',{src:'https://www.youtube.com/live_chat?v=live1'}));
  const moves=replacement.moves;f.resetOperations();f.heartbeat();
  assert.ok(f.operations().queries>0);assert.equal(f.status().mode,'normal');
  assert.equal(replacement.parentNode,f.chat);assert.equal(replacement.moves,moves);
});

test('scroll notices changed viewport and native theater state even before their dedicated events arrive', () => {
  const f=fixture({clientWidth:1400,clientHeight:1000});f.settings(true);
  f.doc.documentElement.clientWidth=800;f.resetOperations();f.event('scroll');
  assert.ok(f.operations().queries>0);assert.equal(f.watch.getAttribute('data-ytlp-orientation'),'portrait');
  f.sizeButton.setAttribute('data-title-no-tooltip','Default view');f.event('scroll');
  assert.equal(f.status().mode,'portrait-theater');assert.equal(f.title.parentNode,f.ownerRenderer);
});

test('disabled updates and heartbeat do no DOM work and cannot revive a queued scroll', () => {
  const f=fixture({clientWidth:1400,clientHeight:1000});f.settings(true);
  f.doc.fire('window:scroll');f.changeEnabled(false);
  assert.equal(f.status().reason,'disabled');assert.equal(f.status().active,false);
  assert.equal(f.video.listeners.get('loadedmetadata')?.length||0,0);
  f.resetOperations();
  for(let index=0;index<20;index++){
    f.heartbeat();f.event('yt-player-updated');f.event('resize');f.event('scroll');
  }
  assert.deepEqual(f.operations(),{queries:0,rectReads:0,attributeWrites:0,styleWrites:0,queuedFrames:0});
  f.changeEnabled(true);assert.equal(f.status().mode,'normal');
  assert.equal(f.video.listeners.get('loadedmetadata')?.length,1);
});

test('hidden tabs defer DOM work and refresh current state when made visible', () => {
  const f=fixture({clientWidth:1400,clientHeight:1000});f.settings(true);f.doc.hidden=true;f.resetOperations();
  f.sizeButton.setAttribute('data-title-no-tooltip','Default view');f.resetOperations();
  for(let index=0;index<20;index++){f.event('yt-player-updated');f.event('scroll');f.heartbeat();}
  assert.deepEqual(f.operations(),{queries:0,rectReads:0,attributeWrites:0,styleWrites:0,queuedFrames:0});
  f.doc.hidden=false;f.event('visibilitychange');
  assert.equal(f.status().mode,'landscape-theater');assert.ok(f.operations().queries>0);
});

test('a frame queued before the tab becomes hidden performs no stale DOM work', () => {
  const f=fixture({clientWidth:1400,clientHeight:1000});f.settings(true);
  f.doc.fire('window:scroll');f.doc.hidden=true;f.resetOperations();f.flush();
  assert.deepEqual(f.operations(),{queries:0,rectReads:0,attributeWrites:0,styleWrites:0,queuedFrames:0});
  f.doc.hidden=false;f.chat.rect.top=200;f.event('visibilitychange');
  assert.equal(f.watch.style.getPropertyValue('--ytlp-chat-height'),'788px');
});

test('enabled heartbeat retains late watch mounting and unannounced metadata recovery', () => {
  const f=fixture({clientWidth:1400,clientHeight:1000});f.watch.remove();f.settings(true);
  assert.equal(f.status().reason,'not-watch');
  f.doc.documentElement.appendChild(f.watch);f.heartbeat();assert.equal(f.status().mode,'normal');
  f.player.classes.delete('ytp-live');f.heartbeat();assert.equal(f.status().reason,'not-live');
  f.player.classes.add('ytp-live');f.heartbeat();assert.equal(f.status().mode,'normal');
  f.event('yt-navigate-start');f.heartbeat();assert.equal(f.status().active,false);
  f.event('yt-navigate-finish');assert.equal(f.status().mode,'normal');
});

test('full reconciliations avoid identical mode and orientation writes and unused stage styles', () => {
  const f=fixture({clientWidth:1400,clientHeight:1000});f.settings(true);f.resetOperations();
  for(let index=0;index<5;index++)f.event('yt-player-updated');
  assert.equal(f.operations().attributeWrites,0);assert.equal(f.operations().styleWrites,0);
  f.doc.documentElement.clientWidth=800;f.mutate(f.sizeButton,'data-title-no-tooltip','Default view');
  assert.equal(f.status().mode,'portrait-theater');
  assert.equal(f.watch.style.getPropertyValue('--ytlp-stage-height'),'');
});

if(process.env.YTLP_MEASURE){
  const normal=fixture({headerHeight:56,secondaryInner:true,chatInSecondaryInner:true,clientWidth:1400,clientHeight:1000});
  normal.settings(true);normal.resetOperations();
  for(let index=0;index<120;index++){normal.chat.rect.top=index%2?56:80;normal.event('scroll');}
  const disabled=fixture();disabled.settings(false);disabled.resetOperations();
  for(let index=0;index<20;index++)disabled.heartbeat();
  const hidden=fixture({headerHeight:56,secondaryInner:true,chatInSecondaryInner:true,clientWidth:1400,clientHeight:1000});
  hidden.settings(true);hidden.doc.hidden=true;hidden.resetOperations();
  for(let index=0;index<20;index++){hidden.event('yt-player-updated');hidden.heartbeat();}
  console.log(JSON.stringify({mockOperations:{normalScroll120:normal.operations(),disabledHeartbeat20:disabled.operations(),hiddenUpdates20:hidden.operations()}}));
}
console.log(`${passed} passed; ${failed} failed. DOM contract tests only; no browser rendering or playback verification.`);
process.exitCode = failed ? 1 : 0;
