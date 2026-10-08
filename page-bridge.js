(() => {
  const LABEL_KEYS = [
    "alteredOrSyntheticContent",
    "hasAlteredContent",
    "isAlteredContent",
    "syntheticContent",
    "aiGenerated"
  ];

  function findDisclosure(node, depth) {
    if (!node || depth > 8 || typeof node !== "object") return null;
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = findDisclosure(item, depth + 1);
        if (found) return found;
      }
      return null;
    }
    for (const key of LABEL_KEYS) {
      if (node[key] === true || node[key] === "true") {
        return { source: key, text: "YouTube marked this video as altered or synthetic." };
      }
    }
    const content = node.content || node.simpleText || node.label || "";
    if (typeof content === "string" && /altered or synthetic|made with generative ai|ai-generated content/i.test(content)) {
      return { source: "text", text: content.slice(0, 180) };
    }
    for (const value of Object.values(node)) {
      if (value && typeof value === "object") {
        const found = findDisclosure(value, depth + 1);
        if (found) return found;
      }
    }
    return null;
  }

  function publish() {
    const player = window.ytInitialPlayerResponse;
    const videoId = player?.videoDetails?.videoId || null;
    const channelId = player?.videoDetails?.channelId || null;
    const author = player?.videoDetails?.author || null;
    const disclosure = player ? findDisclosure(player, 0) : null;
    window.dispatchEvent(new CustomEvent("fasb-player", {
      detail: { videoId, channelId, author, disclosure }
    }));
  }

  const wrap = (name) => {
    const original = window[name];
    if (typeof original !== "function" || original.__fasb) return;
    const wrapped = function (...args) {
      const result = original.apply(this, args);
      setTimeout(publish, 0);
      return result;
    };
    wrapped.__fasb = true;
    window[name] = wrapped;
  };

  wrap("ytInitialPlayerResponse");
  document.addEventListener("yt-navigate-finish", () => setTimeout(publish, 50));
  setTimeout(publish, 400);
  setInterval(publish, 2500);
})();
