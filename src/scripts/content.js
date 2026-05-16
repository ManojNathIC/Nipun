// DevAssist AI - Content Script

/**
 * Listen for messages from the background service worker.
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "PING") {
    sendResponse({ status: "OK" });
    return true; // Keep channel open for async if needed
  }

  if (request.action === "REPLACE_TEXT") {
    replaceSelectedText(request.text);
  } else if (request.action === "START_IMPROVING") {
    // Optional: Add a simple indicator if desired (e.g., cursor shape change or a toast)
    console.log("AI is improving text...");
  } else if (request.action === "ERROR") {
    alert(request.message);
  }
});

/**
 * Replaces the currently selected text in the active element.
 * Handles both standard inputs (input, textarea) and contenteditable elements.
 * @param {string} improvedText - The text returned by Gemini.
 */
function replaceSelectedText(improvedText) {
  const activeEl = document.activeElement;

  if (!activeEl) return;

  // Case 1: Standard Input or Textarea
  if (
    activeEl.tagName === "TEXTAREA" ||
    (activeEl.tagName === "INPUT" &&
      /^(text|search|tel|url|password)$/i.test(activeEl.type))
  ) {
    const start = activeEl.selectionStart;
    const end = activeEl.selectionEnd;
    const value = activeEl.value;

    // Use slice to insert the new text
    activeEl.value = value.slice(0, start) + improvedText + value.slice(end);

    // Maintain focus and set selection after the new text
    activeEl.focus();
    activeEl.setSelectionRange(
      start + improvedText.length,
      start + improvedText.length,
    );

    // Trigger 'input' event so any page logic (like auto-save) sees the change
    activeEl.dispatchEvent(new Event("input", { bubbles: true }));
  }
  // Case 2: ContentEditable elements (e.g., Gmail, Slack, etc.)
  else if (activeEl.isContentEditable) {
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);

      // Delete existing selection
      range.deleteContents();

      // Insert the improved text as a text node
      const textNode = document.createTextNode(improvedText);
      range.insertNode(textNode);

      // Move cursor to the end of the newly inserted text
      range.setStartAfter(textNode);
      range.setEndAfter(textNode);
      selection.removeAllRanges();
      selection.addRange(range);

      // Trigger 'input' event for contenteditable
      activeEl.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }
}
