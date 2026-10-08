const DEFAULTS = {
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
  stats: { hidden: 0, labeledSeen: 0, learned: 0 }
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(null, (current) => {
    const next = { ...DEFAULTS, ...current };
    next.blocked = current.blocked || {};
    next.allowed = current.allowed || {};
    next.stats = current.stats || { hidden: 0, labeledSeen: 0, learned: 0 };
    next.blockedVideos = current.blockedVideos || {};
    next.model = current.model || { tokens: {}, neighbors: {}, trained: {}, channelHints: {}, samples: 0 };
    chrome.storage.local.set(next);
  });
});
