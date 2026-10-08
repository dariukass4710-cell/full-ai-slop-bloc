function parse(raw) {
  const value = raw.trim();
  if (value.startsWith("@")) return { handle: value.slice(1).toLowerCase(), channelId: null };
  if (/^UC[\w-]{20,}$/.test(value)) return { channelId: value, handle: null };
  const id = value.match(/channel\/(UC[\w-]{20,})/);
  const handle = value.match(/@([^/?#]+)/);
  return {
    channelId: id ? id[1] : null,
    handle: handle ? decodeURIComponent(handle[1]).toLowerCase() : value.toLowerCase()
  };
}

function render(list, bucket) {
  list.innerHTML = "";
  const entries = Object.entries(bucket);
  if (!entries.length) {
    list.innerHTML = "<li><span>None yet.</span></li>";
    return;
  }
  for (const [key, item] of entries) {
    const li = document.createElement("li");
    const label = document.createElement("div");
    label.innerHTML = `<strong></strong><br><span></span>`;
    label.querySelector("strong").textContent = item.name || key;
    label.querySelector("span").textContent = item.channelId || (item.handle ? `@${item.handle}` : key);
    const remove = document.createElement("button");
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      delete bucket[key];
      const patch = list.id === "blocked" ? { blocked: bucket } : { allowed: bucket };
      chrome.storage.local.set(patch, load);
    });
    li.append(label, remove);
    list.appendChild(li);
  }
}

function load() {
  chrome.storage.local.get(["blocked", "allowed", "blockedVideos", "model"], (data) => {
    render(document.getElementById("blocked"), data.blocked || {});
    render(document.getElementById("allowed"), data.allowed || {});
    renderVideos(data.blockedVideos || {});
    const blocks = Object.keys(data.blocked || {}).length + Object.keys(data.blockedVideos || {}).length;
    const words = Object.entries(data.model?.tokens || {}).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([word]) => word);
    document.getElementById("train-status").textContent = blocks < 2
      ? `${blocks} blocks. Similar videos start fading after 2.`
      : `Trained on ${blocks} blocks. Strongest words: ${words.join(", ") || "none yet"}.`;
  });
}

function renderVideos(videos) {
  const list = document.getElementById("videos");
  list.innerHTML = "";
  const entries = Object.entries(videos);
  if (!entries.length) {
    list.innerHTML = "<li><span>None yet. Use Block this video on a watch page.</span></li>";
    return;
  }
  for (const [id, item] of entries) {
    const li = document.createElement("li");
    const label = document.createElement("div");
    label.innerHTML = `<strong></strong><br><span></span>`;
    label.querySelector("strong").textContent = item.title || id;
    label.querySelector("span").textContent = item.name ? `${item.name} · ${id}` : id;
    const remove = document.createElement("button");
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      delete videos[id];
      chrome.storage.local.set({ blockedVideos: videos }, load);
    });
    li.append(label, remove);
    list.appendChild(li);
  }
}

function bind(formId, nameId, idId, bucketName) {
  document.getElementById(formId).addEventListener("submit", (event) => {
    event.preventDefault();
    const name = document.getElementById(nameId).value.trim();
    const parsed = parse(document.getElementById(idId).value);
    const key = parsed.channelId || (parsed.handle ? `@${parsed.handle}` : null);
    if (!key) return;
    chrome.storage.local.get(bucketName, (data) => {
      const bucket = data[bucketName] || {};
      bucket[key] = { name, ...parsed };
      chrome.storage.local.set({ [bucketName]: bucket }, () => {
        event.target.reset();
        load();
      });
    });
  });
}

bind("block-form", "block-name", "block-id", "blocked");
bind("allow-form", "allow-name", "allow-id", "allowed");
document.getElementById("reset-training").addEventListener("click", () => {
  chrome.storage.local.set({ model: { tokens: {}, neighbors: {}, trained: {}, samples: 0 } }, load);
});
load();
