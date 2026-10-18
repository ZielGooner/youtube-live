(() => {
  'use strict';
  if (window !== window.top || window.__ytlpInstalled) return;
  window.__ytlpInstalled = true;

  const ATTR = 'data-ytlp-part';
  const CHAT_BOTTOM_GAP = 12;
  let enabled = false;
  let settingsReady = false;
  let watch = null;
  let active = false;
  let mode = null;
  let reason = 'loading';
  let scheduled = false;
  let navigating = false;
  let recommendationHome = null;
  let titleHome = null;
  let tagged = [];
  let watchedVideo = null;
  let observer = null;
  let flowParents = [];
  let watchedInfo = null;
  let settling = false;
  let lastLayoutViewport = '';
  let hiddenHeaderHeight = 0;
  const infoObserver = new ResizeObserver(() => schedule());

  function visible(el) {
    return !!el && !el.hidden && el.getBoundingClientRect().width > 0 &&
      getComputedStyle(el).visibility !== 'hidden';
  }

  function setVariable(name, value) {
    if (watch.style.getPropertyValue(name) !== value) watch.style.setProperty(name, value);
  }

  function tag(el, part) {
    if (!el) return;
    if (el.getAttribute(ATTR) !== part) el.setAttribute(ATTR, part);
    if (!tagged.includes(el)) tagged.push(el);
  }

  function restoreRecommendations() {
    const home = recommendationHome;
    recommendationHome = null;
    if (!home) return;
    // Restore only our own relocation. YouTube may already have moved/replaced it.
    if (home.marker.isConnected && home.node.parentNode === home.destination) {
      home.marker.parentNode.insertBefore(home.node, home.marker);
    } else if (home.node.parentNode === home.destination) {
      if (home.parent.isConnected) {
        home.parent.insertBefore(home.node, home.next?.parentNode === home.parent ? home.next : null);
      } else {
        // The page discarded its original subtree; this detached recommendation
        // list must not survive as a duplicate belonging to the previous page.
        home.node.remove();
      }
    }
    home.marker.remove();
  }

  function deactivate(nextReason) {
    reason = nextReason;
    document.documentElement.removeAttribute('data-ytlp-portrait');
    hiddenHeaderHeight = 0;
    if (watch) {
      watch.removeAttribute('data-ytlp-active');
      watch.removeAttribute('data-ytlp-mode');
      watch.removeAttribute('data-ytlp-orientation');
      for (const name of ['--ytlp-stage-height', '--ytlp-player-height', '--ytlp-chat-height', '--ytlp-info-max-height', '--ytlp-chat-sticky-top']) watch.style.removeProperty(name);
    }
    for (const el of tagged) el.removeAttribute(ATTR);
    tagged = [];
    for (const el of flowParents) el.removeAttribute('data-ytlp-flow');
    flowParents = [];
    infoObserver.disconnect();
    watchedInfo = null;
    restoreRecommendations();
    restoreTitle();
    lastLayoutViewport = '';
    active = false;
    mode = null;
  }

  function placeRecommendations(destination, before = null) {
    if (recommendationHome && !recommendationHome.marker.isConnected && !recommendationHome.parent.isConnected) restoreRecommendations();
    const related = [...watch.querySelectorAll('#related')].find(el => el.querySelector('ytd-watch-next-secondary-results-renderer'));
    if (!related) return;
    if (recommendationHome && (recommendationHome.node !== related || recommendationHome.destination !== destination || related.parentNode !== destination)) restoreRecommendations();
    const needsPlacement = related.parentNode !== destination ||
      (before && before !== related && related.nextSibling !== before);
    if (!recommendationHome && needsPlacement) {
      const marker = document.createComment('ytlp-recommendations-home');
      const parent = related.parentNode;
      const next = related.nextSibling;
      related.before(marker);
      recommendationHome = {node:related, marker, parent, next, destination};
      destination.insertBefore(related, before?.parentNode === destination ? before : null);
    }
    tag(related, 'recommendations');
  }

  function updateEmptySecondaryColumn(chat, video) {
    const secondary = watch.querySelector('#secondary');
    if (!secondary) return;
    const inner = secondary.querySelector('#secondary-inner');
    const empty = inner && !secondary.contains(chat) && !secondary.contains(video) &&
      [...inner.children].every(child => child.hidden || child.hasAttribute('hidden') || child.getBoundingClientRect().height <= 0);
    if (empty) tag(secondary, 'empty-column');
    else if (secondary.getAttribute(ATTR) === 'empty-column') secondary.removeAttribute(ATTR);
  }

  function updateStickyChatHost(chat, video) {
    const inner = watch.querySelector('#secondary-inner');
    const host = inner?.contains(chat) && !inner.contains(video) ? inner : null;
    for (const el of tagged) {
      if (el !== host && el.getAttribute(ATTR) === 'sticky-chat-host') el.removeAttribute(ATTR);
    }
    if (host) tag(host, 'sticky-chat-host');
    return host;
  }

  function restoreTitle() {
    const home = titleHome;
    titleHome = null;
    if (!home) return;
    home.row?.removeAttribute('data-ytlp-empty-title');
    if (home.node.parentNode === home.destination) {
      const replacement = home.parent.querySelector('h1');
      if (replacement && replacement !== home.node) home.node.remove();
      else if (home.marker.isConnected) home.marker.parentNode.insertBefore(home.node, home.marker);
      else if (home.parent.isConnected) home.parent.insertBefore(home.node, home.next?.parentNode === home.parent ? home.next : null);
      else home.node.remove();
    }
    home.marker.remove();
  }

  function placeTitle(metadata) {
    const title = metadata?.querySelector('h1');
    const destination = metadata?.querySelector('ytd-video-owner-renderer');
    const channel = destination?.querySelector('#upload-info');
    if (titleHome && (titleHome.node !== title || titleHome.destination !== destination || title?.parentNode !== destination)) restoreTitle();
    if (!title || !destination || channel?.parentNode !== destination) return;
    if (!titleHome) {
      const parent = title.parentNode;
      const marker = document.createComment('ytlp-title-home');
      const candidateRow = title.closest('#title-row') || title.closest('#title');
      const row = candidateRow !== title && !candidateRow?.contains(destination) ? candidateRow : null;
      const next = title.nextSibling;
      title.before(marker);
      titleHome = {node:title, marker, parent, next, destination, row};
      destination.insertBefore(title, channel.nextSibling);
      row?.setAttribute('data-ytlp-empty-title', '');
    }
    tag(title, 'title');
  }

  function viewportSize() {
    // innerHeight includes a horizontal scrollbar. Only the usable document
    // area can contain the chat composer without requiring page scrolling.
    return {width:document.documentElement.clientWidth || innerWidth,
      height:document.documentElement.clientHeight || innerHeight};
  }

  function isReplay(chat) {
    const iframe = chat?.querySelector('iframe');
    if (!iframe) return false;
    // Read only: never inject into the chat, click its menus, or change its URL.
    let url = iframe.getAttribute('src') || '';
    try { url = iframe.contentDocument?.URL || url; } catch (_) { /* Cross-origin frames use the src fallback. */ }
    return /\/live_chat_replay(?:[?/#]|$)/.test(url);
  }

  function isLive(w, player) {
    // A replay still has a chat frame. Require a current live player, or live metadata
    // without an end date. Never classify a video solely by the existence of chat.
    const meta = w.querySelector('[itemprop="isLiveBroadcast"]') || document.querySelector('meta[itemprop="isLiveBroadcast"]');
    const end = w.querySelector('[itemprop="endDate"]') || document.querySelector('meta[itemprop="endDate"]');
    if (end?.getAttribute('content')) return false;
    if (player?.classList.contains('ytp-live')) return true;
    return /^true$/i.test(meta?.getAttribute('content') || '') && !end?.getAttribute('content');
  }

  function isTheater(w, player) {
    // YouTube can leave aria-label stale after toggling the mode. Its current
    // tooltip title changes correctly, even in the watch-while panel layout.
    const button = player?.querySelector('.ytp-size-button');
    for (const attr of ['data-title-no-tooltip', 'data-tooltip-title', 'title', 'aria-label']) {
      const label = button?.getAttribute(attr) || '';
      if (/기본 보기|Default view/i.test(label)) return true;
      if (/영화관 모드|Theater mode|Theatre mode/i.test(label)) return false;
    }
    return w.hasAttribute('theater') && !w.hasAttribute('watch-while-panels-active');
  }

  function connectWatch(next) {
    if (watch === next) return;
    deactivate('loading');
    observer?.disconnect();
    watch = next;
    if (!watch) return;
    watch.setAttribute('data-ytlp-version', '1.0.11');
    observer = new MutationObserver(records => {
      if (records.some(r => r.type === 'childList' || !r.attributeName?.startsWith('data-ytlp'))) schedule();
    });
    observer.observe(watch, {subtree:true, childList:true, attributes:true,
      attributeFilter:['hidden','collapsed','theater','fullscreen','video-id','class','aria-label','title',
        'data-title-no-tooltip','data-tooltip-title','watch-while-panels-active','live-chat-present-and-expanded']});
  }

  function nativeRelayout() {
    if (settling) return;
    settling = true;
    // Let YouTube finish reparenting/sizing its own player with our overrides
    // removed, then ask it to measure the restored layout once.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      settling = false;
      window.dispatchEvent(new Event('resize'));
      schedule();
    }));
  }

  function releaseBeforeModeChange() {
    // All active modes can change the space available to YouTube's player.
    // In wide theater, for example, the former recommendation column collapses.
    if (!active) return;
    deactivate('loading');
    nativeRelayout();
  }

  function flattenAncestors(elements) {
    const next = new Set();
    for (const element of elements) {
      for (let parent = element?.parentElement; parent && parent !== watch; parent = parent.parentElement) next.add(parent);
    }
    for (const parent of flowParents) if (!next.has(parent)) parent.removeAttribute('data-ytlp-flow');
    for (const parent of next) if (!parent.hasAttribute('data-ytlp-flow')) parent.setAttribute('data-ytlp-flow', '');
    flowParents = [...next];
  }

  function bindVideo(video) {
    if (watchedVideo === video) return;
    if (watchedVideo) {
      watchedVideo.removeEventListener('loadedmetadata', schedule);
      watchedVideo.removeEventListener('resize', schedule);
      watchedVideo.removeEventListener('ended', schedule);
    }
    watchedVideo = video;
    if (video) {
      video.addEventListener('loadedmetadata', schedule);
      video.addEventListener('resize', schedule);
      video.addEventListener('ended', schedule);
    }
  }

  function reconcile() {
    scheduled = false;
    if (navigating || settling) return;
    const next = document.querySelector('ytd-watch-flexy:not([hidden])');
    connectWatch(next);
    let failure = null;
    const player = watch?.querySelector('#movie_player');
    const video = player?.querySelector('video');
    const chat = watch?.querySelector('ytd-live-chat-frame');
    const urlId = new URL(location.href).searchParams.get('v');
    const id = watch?.getAttribute('video-id');
    bindVideo(video);
    if (!settingsReady) failure = 'loading';
    else if (!enabled) failure = 'disabled';
    else if (location.pathname !== '/watch' || !watch) failure = 'not-watch';
    else if (urlId && id && id !== urlId) failure = 'loading';
    else if (document.fullscreenElement || watch.hasAttribute('fullscreen')) failure = 'fullscreen';
    else if (player?.classList.contains('ytp-player-minimized') || document.querySelector('ytd-miniplayer[active]')) failure = 'miniplayer';
    else if (isReplay(chat) || !isLive(watch, player)) failure = 'not-live';
    else if (!chat || !chat.querySelector('iframe')) failure = 'no-chat';
    else if (chat.hasAttribute('collapsed') || chat.hidden || (!active && !visible(chat))) failure = 'chat-hidden';
    else if (!video) failure = 'loading';

    const theater = watch && isTheater(watch, player);
    const viewport = viewportSize();
    // Include near-square floating windows: browser chrome can otherwise put
    // an apparently tall window just a few pixels beyond the portrait boundary.
    const portrait = viewport.width * 100 <= viewport.height * 103;
    const nextMode = theater ? (portrait ? 'portrait-theater' : 'landscape-theater') : 'normal';
    if (!failure && theater && portrait && viewport.height < 500) failure = 'viewport-small';
    if ((mode === 'portrait-theater' && failure) || (mode && !failure && mode !== nextMode)) {
      deactivate(failure || 'loading');
      nativeRelayout();
      return;
    }
    if (failure) { deactivate(failure); return; }

    const below = watch.querySelector('#below');
    const playerHost = video.closest('#full-bleed-container') || video.closest('#player');
    let infoBox = below?.querySelector('ytd-watch-metadata');
    while (infoBox?.parentElement && infoBox.parentElement !== below) infoBox = infoBox.parentElement;
    if (!below || !infoBox || !playerHost || !watch.contains(playerHost) || infoBox.contains(chat) || below.contains(video)) {
      deactivate('unsupported'); return;
    }
    mode = nextMode;
    watch.setAttribute('data-ytlp-mode', mode);
    // Recommendation sizing follows the viewport even in YouTube's default view.
    watch.setAttribute('data-ytlp-orientation', portrait ? 'portrait' : 'landscape');
    if (!watch.hasAttribute('data-ytlp-active')) watch.setAttribute('data-ytlp-active', '');
    if (mode === 'landscape-theater') {
      // Keep YouTube's wide theater player, chat, title and header unchanged.
      // Only recommendations join the information column below the metadata.
      placeRecommendations(below, infoBox.nextSibling);
      // Some native fixed-chat layouts separately reserve an empty secondary
      // column. Keep it measurable so a newly visible panel restores its width.
      updateEmptySecondaryColumn(chat, video);
      active = true;
      reason = 'landscape-theater';
      return;
    }
    tag(chat, 'chat');
    if (mode === 'normal') {
      const stickyHost = updateStickyChatHost(chat, video);
      let stickyTop = 0;
      if (stickyHost) {
        const header = document.querySelector('ytd-masthead') || document.querySelector('#masthead-container');
        const rect = visible(header) ? header.getBoundingClientRect() : null;
        if (rect?.height > 0 && rect.top < viewport.height && Number.isFinite(rect.bottom)) {
          stickyTop = Math.min(viewport.height, Math.max(0, rect.bottom));
        }
        setVariable('--ytlp-chat-sticky-top', `${stickyTop}px`);
      } else watch.style.removeProperty('--ytlp-chat-sticky-top');
      // At the column's bottom, sticky containment can push the chat upward.
      // Keep the desired top as a floor so that this cannot grow its own height.
      const top = Math.max(0, stickyTop, chat.getBoundingClientRect().top);
      let availableBottom = Math.max(0, viewport.height - CHAT_BOTTOM_GAP);
      const secondary = stickyHost?.parentElement;
      if (secondary?.matches('#secondary')) {
        // Measure the stretched column, not the sticky host whose own height
        // we are changing, so the page end cannot push chat behind the header.
        const bottom = secondary.getBoundingClientRect().bottom;
        if (Number.isFinite(bottom)) availableBottom = Math.min(availableBottom, bottom);
      }
      setVariable('--ytlp-chat-height', `${Math.max(360, availableBottom - top)}px`);
      placeRecommendations(below, infoBox?.nextSibling);
      active = true;
      reason = 'normal';
      return;
    }

    if (!document.documentElement.hasAttribute('data-ytlp-portrait')) {
      const header = document.querySelector('ytd-masthead') || document.querySelector('#masthead-container');
      hiddenHeaderHeight = Math.max(0, header?.getBoundingClientRect().height || 0);
      document.documentElement.setAttribute('data-ytlp-portrait', '');
    }
    tag(playerHost, 'player');
    tag(infoBox, 'info');
    placeTitle(infoBox.matches('ytd-watch-metadata') ? infoBox : infoBox.querySelector('ytd-watch-metadata'));
    flattenAncestors([playerHost, infoBox, chat]);
    if (watchedInfo !== infoBox) {
      infoObserver.disconnect();
      watchedInfo = infoBox;
      infoObserver.observe(infoBox);
    }
    const rootRect = watch.getBoundingClientRect();
    const rootWidth = rootRect.width;
    const stageHeight = Math.max(0, viewport.height - Math.max(0, rootRect.top + scrollY));
    // Give the removed header's height to chat, keeping the video/info budget
    // the same as it was with YouTube's header visible.
    const videoBudget = Math.max(0, stageHeight - hiddenHeaderHeight);
    // YouTube's chat document has its own 320px minimum. Keep a larger outer
    // frame so borders and the complete input panel fit without page scrolling.
    const frameRect = chat.querySelector('iframe').getBoundingClientRect();
    const chatOverhead = frameRect.height > 0 ? Math.max(0, chat.getBoundingClientRect().height - frameRect.height) : 0;
    const minimumChat = Math.max(360, Math.ceil(chatOverhead) + 322);
    const infoGap = 10;
    setVariable('--ytlp-info-max-height', `${Math.max(0, Math.min(videoBudget * .25, videoBudget - minimumChat - 80 - infoGap))}px`);
    const infoHeight = infoBox.getBoundingClientRect().height;
    const ratio = video.videoWidth > 0 && video.videoHeight > 0 ? video.videoWidth / video.videoHeight : 16 / 9;
    const playerHeight = Math.max(0, Math.min(rootWidth / ratio, videoBudget - infoHeight - infoGap - minimumChat));
    setVariable('--ytlp-stage-height', `${stageHeight}px`);
    setVariable('--ytlp-player-height', `${playerHeight}px`);
    setVariable('--ytlp-chat-height', `${Math.max(minimumChat, stageHeight - playerHeight - infoHeight - infoGap)}px`);
    // Metadata tooltips and description expansion must not trigger YouTube's
    // whole-page responsive layout. Notify only on entry or viewport changes.
    const layoutViewport = `${viewport.width}:${viewport.height}`;
    if (lastLayoutViewport !== layoutViewport) {
      lastLayoutViewport = layoutViewport;
      requestAnimationFrame(() => {
        if (active && mode === 'portrait-theater') window.dispatchEvent(new Event('resize'));
      });
    }

    // Media and chat (and all their ancestors) stay connected in their original
    // DOM locations. Flex order stacks the player, metadata and chat. Only the
    // non-media title and recommendations are relocated, with restore markers.
    placeRecommendations(watch);
    active = true;
    reason = 'portrait-theater';
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(reconcile);
  }

  window.addEventListener('resize', schedule, {passive:true});
  document.addEventListener('click', event => {
    if (event.target.closest?.('.ytp-size-button, .ytp-fullscreen-button')) releaseBeforeModeChange();
  }, true);
  document.addEventListener('keydown', event => {
    if (event.ctrlKey || event.altKey || event.metaKey || event.target.closest?.('input, textarea, [contenteditable="true"]')) return;
    if (/^[tf]$/i.test(event.key)) releaseBeforeModeChange();
  }, true);
  window.addEventListener('scroll', () => { if (mode === 'normal') schedule(); }, {passive:true});
  window.visualViewport?.addEventListener('resize', schedule, {passive:true});
  document.addEventListener('fullscreenchange', schedule);
  document.addEventListener('yt-navigate-start', () => {
    navigating = true;
    deactivate('loading');
  });
  for (const event of ['yt-navigate-finish','yt-page-data-updated','yt-player-updated']) {
    document.addEventListener(event, () => { navigating = false; schedule(); });
  }
  window.addEventListener('popstate', () => { navigating = false; schedule(); });
  chrome.storage.local.get({enabled:true}, data => {
    if (chrome.runtime.lastError) return;
    enabled = data.enabled !== false;
    settingsReady = true;
    schedule();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.enabled) {
      enabled = changes.enabled.newValue !== false;
      settingsReady = true;
      schedule();
    }
  });
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type === 'ytlp:get-status') respond({enabled,active,reason,mode,version:'1.0.11'});
  });
  // A low frequency recovery check covers late watch mounts and future SPA events.
  // Hidden tabs don't repeatedly walk the DOM, and no iframe messages are observed.
  setInterval(() => { if (!document.hidden) schedule(); }, 1500);
  document.addEventListener('visibilitychange', schedule);
  schedule();
})();
