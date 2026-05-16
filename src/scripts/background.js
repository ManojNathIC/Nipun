// Nipun - Background Service Worker

importScripts("api.js");
importScripts("github-api.js");

// Cache activeMode so the click handler never needs to await storage.
let cachedActiveMode = null;

// Load initial value when the service worker starts.
chrome.storage.local.get("activeMode", ({ activeMode }) => {
  cachedActiveMode = activeMode || null;
});

// Keep cache in sync whenever storage changes.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.activeMode) {
    cachedActiveMode = changes.activeMode.newValue;
  }
});

// Create context menu on extension installation
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "improveText",
    title: "Improve with AI",
    contexts: ["selection"],
  });
});

/**
 * Handle extension icon click.
 * - If last active mode was "reviewer", open the side panel.
 * - Otherwise open the popup.
 * Note: action.onClicked only fires when default_popup is empty.
 * We manage popup dynamically so we can intercept the click.
 *
 * sidePanel.open() MUST be called synchronously (no await before it)
 * to satisfy Chrome's user gesture requirement — hence the cached mode.
 */
chrome.action.onClicked.addListener((tab) => {
  if (cachedActiveMode === "reviewer") {
    chrome.sidePanel.open({ tabId: tab.id });
  } else {
    chrome.windows.create({
      url: chrome.runtime.getURL("popup.html"),
      type: "popup",
      width: 400,
      height: 570,
    });
  }
});

// Clear default_popup so action.onClicked fires
chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setPopup({ popup: "" });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.action.setPopup({ popup: "" });
});

/**
 * Safely sends a message to the content script.
 * Returns true if successful, false otherwise.
 */
async function safeSendMessage(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
    return true;
  } catch (error) {
    if (error.message.includes("Could not establish connection")) {
      console.warn("Content script not ready in this tab.");
      return false;
    }
    throw error;
  }
}

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "improveText" && info.selectionText) {
    const originalText = info.selectionText;

    // Check if content script is injected
    const isReady = await safeSendMessage(tab.id, { action: "PING" });

    if (!isReady) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content.js"],
        });
        const retryReady = await safeSendMessage(tab.id, { action: "PING" });
        if (!retryReady) throw new Error("Content script injection failed.");
      } catch (err) {
        console.error("Injection failed:", err);
        return;
      }
    }

    try {
      await safeSendMessage(tab.id, { action: "START_IMPROVING" });

      const improvedText = await fetchGeminiResponse(originalText);

      if (improvedText) {
        await safeSendMessage(tab.id, {
          action: "REPLACE_TEXT",
          text: improvedText,
        });
      } else {
        throw new Error("Empty response from AI.");
      }
    } catch (error) {
      console.error("Nipun Error:", error);
      await safeSendMessage(tab.id, {
        action: "ERROR",
        message: "Failed to improve text: " + error.message,
      });
    }
  }
});

// Handle messages from content scripts or sidepanel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "POST_GITHUB_COMMENT") {
    const { owner, repo, prNumber, body } = message;
    postPRComment(owner, repo, prNumber, body)
      .then((data) => sendResponse({ success: true, data }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true; // Keep channel open for async response
  }
});
