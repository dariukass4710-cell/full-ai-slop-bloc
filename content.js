(() => {
  const CARD_SELECTORS = [
    "ytd-rich-item-renderer",
    "ytd-video-renderer",
    "ytd-compact-video-renderer",
    "ytd-grid-video-renderer",
    "ytd-reel-item-renderer",
    "ytd-rich-grid-media",
    "ytd-compact-radio-renderer"
  ].join(",");

  const STOP = new Set("the a an and or of to in on for with you your this that from video videos official channel new watch shorts youtube just how what why are was were been has have not but about into over after episode part full".split(" "));

  const state = {
    enabled: true,
    mode: "channels",
    hideInFeeds: true,
    coverPlayer: true,
    blockAutoplay: true,
    learnSimilar: true,
    blocked: {},
    allowed: {},
    blockedVideos: {},
    model: { tokens: {}, neighbors: {}, trained: {}, channelHints: {}, samples: 0 },
    player: null
  };

  const shown = new Set();

  function load() {
    return new Promise((resolve) => {
      chrome.storage.local.get(null, (data) => {
        Object.assign(state, data);
        state.blocked = data.blocked || {};
        state.allowed = data.allowed || {};
        state.blockedVideos = data.blockedVideos || {};
        state.model = data.model || { tokens: {}, neighbors: {}, trained: {}, channelHints: {}, samples: 0 };
        resolve();
      });
    });
  }

  function bump(key) {
    chrome.storage.local.get("stats", (data) => {
      const stats = data.stats || { hidden: 0, labeledSeen: 0, learned: 0 };
      stats[key] = (stats[key] || 0) + 1;
      chrome.storage.local.set({ stats });
    });
  }

  function channelFromHref(href) {
    if (!href) return {};
    const id = href.match(/\/channel\/(UC[\w-]{20,})/);
    const handle = href.match(/\/@([^/?#]+)/);
    return {
      channelId: id ? id[1] : null,
      handle: handle ? decodeURIComponent(handle[1]).toLowerCase() : null
    };
  }

  function isAllowed(identity) {
    const { channelId, handle } = identity;
    return Object.values(state.allowed).some((item) =>
      (channelId && item.channelId === channelId) ||
      (handle && item.handle && item.handle === handle)
    );
  }

  function videoIdFromHref(href) {
    if (!href) return null;
    const watch = href.match(/[?&]v=([\w-]{11})/);
    const shorts = href.match(/\/shorts\/([\w-]{11})/);
    return (watch && watch[1]) || (shorts && shorts[1]) || null;
  }

  function isBlockedVideo(videoId) {
    return Boolean(videoId && state.blockedVideos?.[videoId]);
  }

  function isBlockedChannel(identity) {
    const { channelId, handle } = identity;
    return Object.values(state.blocked).some((item) =>
      (channelId && item.channelId === channelId) ||
      (handle && item.handle && item.handle === handle)
    );
  }

  function cardIdentity(card) {
    const channelLink = card.querySelector('a[href*="/channel/"], a[href*="/@"]');
    const fromLink = channelFromHref(channelLink?.href || "");
    const title = card.querySelector("#video-title, a#video-title, yt-formatted-string");
    const videoLink = card.querySelector('a[href*="watch?v="], a[href*="/shorts/"]');
    return {
      ...fromLink,
      name: channelLink?.textContent?.trim() || "This channel",
      title: title?.textContent?.trim() || "",
      videoId: videoIdFromHref(videoLink?.href || "")
    };
  }

  function cardLooksLabeled(card) {
    const badges = [...card.querySelectorAll("ytd-badge-supported-renderer, .badge, [class*='badge']")];
    if (badges.some((badge) => badge.textContent.trim() === "AI")) return true;
    const text = card.innerText || "";
    return /altered or synthetic content|ai-generated content/i.test(text);
  }

  function tokens(text) {
    return (text || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2 && !STOP.has(word));
  }

  function sampleCount() {
    return Object.keys(state.blocked).length + Object.keys(state.blockedVideos).length;
  }

  function bars() {
    const drop = Math.min(sampleCount(), 8) * 0.4;
    return {
      dim: Math.max(1.1, 3.4 - drop),
      hide: Math.max(2.1, 5.2 - drop)
    };
  }

  function similarity(identity, title) {
    if (!state.learnSimilar || sampleCount() < 2) return 0;
    const model = state.model || { tokens: {}, neighbors: {} };
    const key = keyFor(identity);
    const neighborHits = key && model.neighbors?.[key] ? model.neighbors[key].count : 0;
    const channelHints = key && model.channelHints?.[key] ? model.channelHints[key] : 0;
    const words = tokens(`${identity.name || ""} ${title || ""}`);
    let weight = 0;
    let hits = 0;
    for (const word of words) {
      const value = model.tokens?.[word] || 0;
      if (value) {
        weight += Math.min(value, 6);
        hits += 1;
      }
    }
    const titleScore = hits >= 2 ? weight / Math.sqrt(words.length || 1) : 0;
    return neighborHits * 1.5 + channelHints * 0.9 + titleScore;
  }

  function shouldHide(identity, labeled, score) {
    if (!state.enabled || isAllowed(identity)) return false;
    if (isBlockedVideo(identity.videoId)) return true;
    if (isBlockedChannel(identity)) return true;
    if (state.mode === "labels" && labeled) return true;
    return score >= bars().hide;
  }

  function reason(identity, labeled, score) {
    if (isBlockedVideo(identity.videoId)) return "Video you blocked";
    if (isBlockedChannel(identity)) return "Channel marked as fully AI slop";
    if (labeled && state.mode === "labels") return "YouTube photoreal AI label. This includes some partial edits.";
    if (score >= bars().hide) return `Similar to ${sampleCount()} blocks you made`;
    return "Hidden";
  }

  function reveal(node) {
    node.classList.remove("fasb-card", "fasb-dim");
    node.querySelector(":scope > .fasb-notice")?.remove();
    node.querySelector(":scope > .fasb-dim-chip")?.remove();
  }

  function hideCard(card, why, learned) {
    if (card.querySelector(":scope > .fasb-notice")) return;
    card.classList.remove("fasb-dim");
    card.querySelector(":scope > .fasb-dim-chip")?.remove();
    card.classList.add("fasb-card");
    const notice = document.createElement("div");
    notice.className = "fasb-notice";
    notice.innerHTML = `<div><strong>Hidden</strong><span></span></div>`;
    notice.querySelector("span").textContent = why;
    const button = document.createElement("button");
    button.className = "fasb-ghost";
    button.textContent = "Show";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      reveal(card);
      shown.add(card);
    });
    notice.appendChild(button);
    if (learned) {
      const keep = document.createElement("button");
      keep.className = "fasb-ghost";
      keep.textContent = "Keep channel";
      keep.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        allowChannel(cardIdentity(card));
      });
      notice.appendChild(keep);
    }
    card.appendChild(notice);
    bump(learned ? "learned" : "hidden");
  }

  function dimCard(card, score) {
    if (card.classList.contains("fasb-card") || card.classList.contains("fasb-dim")) return;
    card.classList.add("fasb-dim");
    const chip = document.createElement("div");
    chip.className = "fasb-dim-chip";
    chip.textContent = `Similar to blocked channels · ${score.toFixed(1)}`;
    card.appendChild(chip);
  }

  function scanFeeds() {
    if (!state.hideInFeeds) return;
    document.querySelectorAll(CARD_SELECTORS).forEach((card) => {
      if (shown.has(card) || card.closest(".fasb-card")) return;
      const identity = cardIdentity(card);
      const labeled = cardLooksLabeled(card);
      const score = similarity(identity, identity.title);
      if (labeled) bump("labeledSeen");
      const exact = isBlockedVideo(identity.videoId) || isBlockedChannel(identity);
      if (shouldHide(identity, labeled, score)) {
        hideCard(card, reason(identity, labeled, score), !exact && score >= bars().hide);
      } else if (score >= bars().dim) {
        dimCard(card, score);
      }
    });
  }

  function currentIdentity() {
    const link = document.querySelector("ytd-watch-metadata ytd-channel-name a, #owner a[href*='/@'], #owner a[href*='/channel/']");
    const fromDom = channelFromHref(link?.href || "");
    return {
      channelId: state.player?.channelId || fromDom.channelId,
      handle: fromDom.handle,
      name: state.player?.author || link?.textContent?.trim() || "This channel",
      videoId: state.player?.videoId || new URL(location.href).searchParams.get("v")
    };
  }

  function watchLabeled() {
    if (state.player?.disclosure) return true;
    const zone = document.querySelector("#below, ytd-watch-metadata, #description");
    const text = zone?.innerText || "";
    return /altered or synthetic content|how this content was made/i.test(text);
  }

  function coverPlayer(why, learned) {
    const player = document.querySelector("#movie_player, #player");
    if (!player || !state.coverPlayer) return;
    player.classList.add("fasb-player-wrap");
    if (player.querySelector(":scope > .fasb-player")) return;
    const cover = document.createElement("div");
    cover.className = "fasb-player";
    cover.innerHTML = `<div class="fasb-player-card"><h2>${learned ? "Learned slop match" : "Full-AI slop blocked"}</h2><p></p><div class="fasb-actions"></div></div>`;
    cover.querySelector("p").textContent = why;
    const watch = document.createElement("button");
    watch.textContent = "Watch anyway";
    watch.addEventListener("click", () => {
      cover.remove();
      document.querySelector("video")?.play();
    });
    const allow = document.createElement("button");
    allow.className = "fasb-ghost";
    allow.textContent = "Allow this channel";
    allow.addEventListener("click", () => allowChannel(currentIdentity()));
    cover.querySelector(".fasb-actions").append(watch, allow);
    player.appendChild(cover);
    if (state.blockAutoplay) document.querySelector("video")?.pause();
    bump(learned ? "learned" : "hidden");
  }

  function clearPlayer() {
    document.querySelector("#movie_player > .fasb-player, #player > .fasb-player")?.remove();
  }

  function keyFor(identity) {
    return identity.channelId || (identity.handle ? `@${identity.handle}` : null);
  }

  function trimModel(model) {
    const tokens = Object.entries(model.tokens).sort((a, b) => b[1] - a[1]).slice(0, 200);
    model.tokens = Object.fromEntries(tokens);
    const neighbors = Object.entries(model.neighbors).sort((a, b) => b[1].count - a[1].count).slice(0, 300);
    model.neighbors = Object.fromEntries(neighbors);
    return model;
  }

  function trainFromPage(identity) {
    const key = keyFor(identity);
    if (!key) return;
    const model = state.model || { tokens: {}, neighbors: {}, trained: {}, samples: 0 };
    if (model.trained?.[key]) return;
    const titles = [...document.querySelectorAll("#video-title, a#video-title")].map((el) => el.textContent || "").slice(0, 30);
    for (const title of [identity.name, ...titles]) {
      for (const word of tokens(title)) model.tokens[word] = (model.tokens[word] || 0) + 1;
    }
    document.querySelectorAll('a[href*="/@"], a[href*="/channel/"]').forEach((link) => {
      const neighbor = { ...channelFromHref(link.href), name: link.textContent.trim() };
      const neighborKey = keyFor(neighbor);
      if (!neighborKey || neighborKey === key || neighbor.name.length < 2) return;
      model.neighbors[neighborKey] = model.neighbors[neighborKey] || {
        count: 0,
        name: neighbor.name,
        channelId: neighbor.channelId,
        handle: neighbor.handle
      };
      model.neighbors[neighborKey].count += 1;
    });
    model.trained[key] = Date.now();
    model.samples = sampleCount();
    state.model = trimModel(model);
    chrome.storage.local.set({ model: state.model });
  }

  function addTokens(model, text, weight) {
    for (const word of tokens(text)) model.tokens[word] = (model.tokens[word] || 0) + weight;
  }

  function trainFromVideo(identity, title) {
    const model = state.model || { tokens: {}, neighbors: {}, trained: {}, channelHints: {}, samples: 0 };
    addTokens(model, title, 2);
    const description = document.querySelector("#description-inline-expander, #description")?.innerText || "";
    addTokens(model, description.slice(0, 280), 1);
    const key = keyFor(identity);
    if (key && !isAllowed(identity)) {
      model.channelHints = model.channelHints || {};
      model.channelHints[key] = (model.channelHints[key] || 0) + 1;
      if (model.channelHints[key] >= 3 && !isBlockedChannel(identity)) {
        state.blocked = {
          ...state.blocked,
          [key]: {
            channelId: identity.channelId || null,
            handle: identity.handle || null,
            name: identity.name || key
          }
        };
        chrome.storage.local.set({ blocked: state.blocked });
      }
    }
    model.samples = sampleCount();
    state.model = trimModel(model);
    chrome.storage.local.set({ model: state.model });
  }

  function blockVideo(identity) {
    const videoId = identity.videoId;
    if (!videoId) return;
    const title = document.querySelector("h1.ytd-watch-metadata, h1")?.textContent?.trim() || "Blocked video";
    state.blockedVideos = {
      ...state.blockedVideos,
      [videoId]: {
        title,
        channelId: identity.channelId || null,
        handle: identity.handle || null,
        name: identity.name || "",
        at: Date.now()
      }
    };
    chrome.storage.local.set({ blockedVideos: state.blockedVideos }, () => {
      trainFromVideo(identity, title);
      scanWatch();
      scanFeeds();
    });
  }

  function unblockVideo(videoId) {
    const next = { ...state.blockedVideos };
    delete next[videoId];
    state.blockedVideos = next;
    chrome.storage.local.set({ blockedVideos: next }, scanWatch);
  }

  function saveChannel(bucket, identity) {
    const key = keyFor(identity);
    if (!key) return;
    const entry = {
      channelId: identity.channelId || null,
      handle: identity.handle || null,
      name: identity.name || key
    };
    const next = { ...state[bucket], [key]: entry };
    const other = bucket === "blocked" ? "allowed" : "blocked";
    const otherMap = { ...state[other] };
    delete otherMap[key];
    state[bucket] = next;
    state[other] = otherMap;
    chrome.storage.local.set({ [bucket]: next, [other]: otherMap }, () => {
      if (bucket === "blocked") trainFromPage(identity);
      scanWatch();
      scanFeeds();
    });
  }

  function blockChannel(identity) {
    saveChannel("blocked", identity);
  }

  function allowChannel(identity) {
    saveChannel("allowed", identity);
  }

  function injectMarkButton() {
    const owner = document.querySelector("ytd-watch-metadata #owner, #above-the-fold #owner");
    if (!owner || owner.querySelector(".fasb-mark")) return;
    const identity = currentIdentity();
    const button = document.createElement("button");
    button.className = "fasb-mark";
    const blocked = isBlockedChannel(identity);
    button.textContent = blocked ? "Unmark full-AI channel" : "Mark channel as full-AI slop";
    if (blocked) button.classList.add("fasb-ghost");
    button.addEventListener("click", () => {
      const now = currentIdentity();
      if (isBlockedChannel(now)) {
        const key = keyFor(now);
        const next = { ...state.blocked };
        delete next[key];
        state.blocked = next;
        chrome.storage.local.set({ blocked: next }, scanWatch);
      } else {
        blockChannel(now);
      }
    });
    owner.appendChild(button);
    const videoButton = document.createElement("button");
    videoButton.className = "fasb-mark fasb-ghost";
    const videoId = identity.videoId;
    videoButton.textContent = isBlockedVideo(videoId) ? "Unblock this video" : "Block this video";
    videoButton.addEventListener("click", () => {
      const now = currentIdentity();
      if (isBlockedVideo(now.videoId)) unblockVideo(now.videoId);
      else blockVideo(now);
    });
    owner.appendChild(videoButton);
  }

  function scanWatch() {
    if (!location.pathname.startsWith("/watch") && !location.pathname.startsWith("/shorts")) {
      clearPlayer();
      return;
    }
    injectMarkButton();
    const identity = currentIdentity();
    if (isBlockedChannel(identity)) trainFromPage(identity);
    const labeled = watchLabeled();
    const score = similarity(identity, document.querySelector("h1.ytd-watch-metadata, h1")?.textContent || "");
    if (labeled) {
      const title = document.querySelector("h1.ytd-watch-metadata, h1 yt-formatted-string");
      if (title && !title.querySelector(".fasb-chip")) {
        const chip = document.createElement("span");
        chip.className = "fasb-chip";
        chip.textContent = "YouTube AI label";
        title.appendChild(chip);
      }
    }
    const learned = score >= bars().hide && !isBlockedChannel(identity) && !isBlockedVideo(identity.videoId);
    if (shouldHide(identity, labeled, score)) coverPlayer(reason(identity, labeled, score), learned);
    else clearPlayer();
  }

  let timer = 0;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      scanFeeds();
      scanWatch();
    }, 180);
  }

  window.addEventListener("fasb-player", (event) => {
    state.player = event.detail || null;
    schedule();
  });

  document.addEventListener("yt-navigate-finish", () => {
    state.player = null;
    schedule();
  });

  chrome.storage.onChanged.addListener(() => {
    load().then(schedule);
  });

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  load().then(schedule);
})();
