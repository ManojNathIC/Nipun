// Nipun - Popup Logic

// --- Writer Mode ---
const chatMessages = document.getElementById("chat-messages");
const userInput = document.getElementById("user-input");
const sendBtn = document.getElementById("send-btn");

function appendMessage(text, type) {
  const div = document.createElement("div");
  div.className = `message ${type}`;
  div.innerHTML = `<p>${text.replace(/\n/g, "<br>")}</p>`;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return div;
}

async function handleSend() {
  const text = userInput.value.trim();
  if (!text) return;

  userInput.value = "";
  userInput.disabled = true;
  sendBtn.disabled = true;

  appendMessage(text, "outgoing");
  const loading = appendMessage("AI is thinking...", "incoming loading");

  try {
    const response = await fetchGeminiResponse(text);
    loading.remove();
    appendMessage(response, "incoming");
  } catch (error) {
    loading.remove();
    appendMessage(`Error: ${error.message}`, "incoming");
  } finally {
    userInput.disabled = false;
    sendBtn.disabled = false;
    userInput.focus();
  }
}

sendBtn.addEventListener("click", handleSend);
userInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});

// --- Reviewer Mode ---
const prUrlInput = document.getElementById("pr-url-input");
const reviewBtn = document.getElementById("review-btn");
const reviewOutput = document.getElementById("review-output");

function renderMarkdown(md) {
  return md
    .replace(/^## (.+)$/gm, "<h3>$1</h3>")
    .replace(/^### (.+)$/gm, "<h4>$1</h4>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/^[-*] (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>[\s\S]*?<\/li>)/g, "<ul>$1</ul>")
    .replace(/\n{2,}/g, "<br><br>")
    .replace(/\n/g, "<br>");
}

function setReviewStatus(msg) {
  reviewOutput.innerHTML = `<div class="review-loading">${msg}</div>`;
}

async function handleReview() {
  const url = prUrlInput.value.trim();
  if (!url) return;

  const pr = parsePRUrl(url);
  if (!pr) {
    reviewOutput.innerHTML = `<p class="review-error">❌ Invalid GitHub PR URL. Expected: https://github.com/owner/repo/pull/123</p>`;
    return;
  }

  reviewBtn.disabled = true;

  try {
    setReviewStatus("Fetching PR metadata...");
    const meta = await fetchPRMeta(pr.owner, pr.repo, pr.number);

    setReviewStatus("Fetching changed files...");
    const files = await fetchPRFiles(pr.owner, pr.repo, pr.number);

    const reviewableFiles = files.filter((f) => f.patch);
    if (reviewableFiles.length === 0) {
      reviewOutput.innerHTML = `<p class="review-error">⚠️ No reviewable diffs found (PR may only contain binary or renamed files).</p>`;
      return;
    }

    const chunks = chunkFiles(reviewableFiles);
    const totalChunks = chunks.length;
    let fullReview = "";

    for (let i = 0; i < chunks.length; i++) {
      setReviewStatus(
        totalChunks > 1
          ? `Reviewing batch ${i + 1} of ${totalChunks} (${chunks[i].length} files)...`
          : `Running ONDC frontend review on ${reviewableFiles.length} file(s)...`,
      );

      const diff = buildDiffText(chunks[i]);
      const chunkTitle =
        totalChunks > 1
          ? `${meta.title} [Part ${i + 1}/${totalChunks}]`
          : meta.title;

      const result = await fetchGeminiReview(diff, chunkTitle);
      fullReview +=
        (totalChunks > 1 ? `\n\n## Batch ${i + 1}/${totalChunks}\n` : "") +
        result;
    }

    reviewOutput.innerHTML = `
      <div class="review-meta">
        <strong>${meta.title}</strong>
        <span>${reviewableFiles.length} file(s) reviewed${totalChunks > 1 ? ` in ${totalChunks} batches` : ""}</span>
      </div>
      <div class="review-result">${renderMarkdown(fullReview)}</div>
    `;
  } catch (err) {
    reviewOutput.innerHTML = `<p class="review-error">❌ ${err.message}</p>`;
  } finally {
    reviewBtn.disabled = false;
  }
}

reviewBtn.addEventListener("click", handleReview);
prUrlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    handleReview();
  }
});

// --- Mode Switcher ---
const tabs = document.querySelectorAll(".tab-btn");
const panels = document.querySelectorAll(".mode-panel");
const headerTitle = document.getElementById("header-title");

const titles = { writer: "Nipun", reviewer: "MR Reviewer" };

function switchMode(mode, openPanel = false) {
  tabs.forEach((t) => t.classList.remove("active"));
  panels.forEach((p) => p.classList.remove("active"));

  document.querySelector(`[data-mode="${mode}"]`).classList.add("active");
  document.getElementById(`mode-${mode}`).classList.add("active");
  headerTitle.textContent = titles[mode];

  // Persist to both localStorage (popup restore) and chrome.storage.local (background)
  localStorage.setItem("activeMode", mode);
  chrome.storage.local.set({ activeMode: mode });

  if (mode === "reviewer" && openPanel) {
    // Open side panel and close popup
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      chrome.sidePanel.open({ tabId: tab.id });
      window.close();
    });
    return;
  }

  if (mode === "writer") userInput.focus();
  else prUrlInput.focus();
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => switchMode(tab.dataset.mode, true));
});

// Restore last active tab (don't auto-open panel on restore, just show the tab)
const savedMode = localStorage.getItem("activeMode") || "writer";
switchMode(savedMode, false);
