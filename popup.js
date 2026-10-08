const fields = ["enabled", "mode", "hideInFeeds", "coverPlayer", "blockAutoplay", "learnSimilar"];

function readForm() {
  return {
    enabled: document.getElementById("enabled").checked,
    mode: document.getElementById("mode").value,
    hideInFeeds: document.getElementById("hideInFeeds").checked,
    coverPlayer: document.getElementById("coverPlayer").checked,
    blockAutoplay: document.getElementById("blockAutoplay").checked,
    learnSimilar: document.getElementById("learnSimilar").checked
  };
}

chrome.storage.local.get(null, (data) => {
  document.getElementById("enabled").checked = data.enabled !== false;
  document.getElementById("mode").value = data.mode || "channels";
  document.getElementById("hideInFeeds").checked = data.hideInFeeds !== false;
  document.getElementById("coverPlayer").checked = data.coverPlayer !== false;
  document.getElementById("blockAutoplay").checked = data.blockAutoplay !== false;
  document.getElementById("learnSimilar").checked = data.learnSimilar !== false;
  document.getElementById("videos").textContent = Object.keys(data.blockedVideos || {}).length;
  document.getElementById("learned").textContent = data.stats?.learned || 0;
});

for (const id of fields) {
  document.getElementById(id).addEventListener("change", () => {
    chrome.storage.local.set(readForm());
  });
}

document.getElementById("options").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});
