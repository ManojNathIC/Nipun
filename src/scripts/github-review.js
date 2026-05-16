// DevAssist AI - GitHub PR Review Content Script

(function () {
  // Avoid double-injection
  if (document.getElementById("ai-review-btn")) return;

  /**
   * Extracts the diff text from the GitHub PR Files Changed tab.
   * Targets the rendered diff lines in the DOM.
   */
  function extractDiff() {
    const diffContainers = document.querySelectorAll(
      ".diff-table, table.diff-table",
    );

    if (diffContainers.length === 0) return null;

    let diffText = "";
    let fileCount = 0;

    document.querySelectorAll(".file").forEach((fileBlock) => {
      const fileHeader = fileBlock.querySelector(
        ".file-header [data-path], .file-info .link-gray-dark",
      );
      const filename = fileHeader?.textContent?.trim() || "unknown file";

      diffText += `\n--- ${filename} ---\n`;
      fileCount++;

      fileBlock.querySelectorAll(".diff-table tr").forEach((row) => {
        const addition = row.querySelector(".blob-code-addition");
        const deletion = row.querySelector(".blob-code-deletion");
        const context = row.querySelector(".blob-code-context");

        if (addition) diffText += `+ ${addition.textContent.trim()}\n`;
        else if (deletion) diffText += `- ${deletion.textContent.trim()}\n`;
        else if (context) diffText += `  ${context.textContent.trim()}\n`;
      });
    });

    return fileCount > 0 ? diffText : null;
  }

  /**
   * Gets the HEAD commit SHA from the PR page DOM.
   * GitHub renders it in the latest commit link.
   */
  function getHeadSha() {
    // GitHub renders the latest commit SHA in a link like /commit/abc1234
    const commitLink = document.querySelector(
      '.TimelineItem--condensed a[href*="/commit/"], .js-commits-list-item a[href*="/commit/"]',
    );
    if (commitLink) {
      const match = commitLink.href.match(/\/commit\/([0-9a-f]{7,40})/i);
      if (match) return match[1];
    }
    // Fallback: look for sha in any commit permalink on the page
    const allLinks = document.querySelectorAll('a[href*="/commit/"]');
    for (const link of allLinks) {
      const match = link.href.match(/\/commit\/([0-9a-f]{40})/i);
      if (match) return match[1];
    }
    return null;
  }

  /**
   * Gets the PR title from the page.
   */
  function getPRTitle() {
    return (
      document
        .querySelector(
          ".js-issue-title, h1.gh-header-title span.markdown-title",
        )
        ?.textContent?.trim() || ""
    );
  }

  /**
   * Simple markdown to HTML renderer for the review output.
   */
  function renderMarkdown(md) {
    return md
      .replace(/^## (.+)$/gm, "<h3>$1</h3>")
      .replace(/^### (.+)$/gm, "<h4>$1</h4>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/^[-*] (.+)$/gm, "<li>$1</li>")
      .replace(/(<li>.*<\/li>)/gs, "<ul>$1</ul>")
      .replace(/\n{2,}/g, "</p><p>")
      .replace(/^(?!<[hul])/gm, "")
      .replace(/\n/g, "<br>");
  }

  /**
   * Extracts a summary of top findings from the markdown review.
   * Looks for [CRITICAL], [HIGH], [MEDIUM] items.
   */
  function extractReviewSummary(review) {
    const lines = review.split("\n");
    const topIssues = [];
    let summaryText = "";
    let inSummary = false;
    let currentIssue = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Summary Extraction
      if (line.match(/^(#+\s*)?Summary/i)) {
        inSummary = true;
        continue;
      }
      if (
        inSummary &&
        line.match(
          /^(#+\s*)?(Findings|React|Chart|API|Filter|Naming|Modularity|Performance|Responsiveness|Localisation|Security|TypeScript|Code quality)/i,
        )
      ) {
        inSummary = false;
      }
      if (inSummary && line && !line.match(/^#+/)) {
        summaryText += line + " ";
      }

      // Top Findings Extraction
      const findingMatch = line.match(
        /^(#+\s*|[-*]\s*)?\[(CRITICAL|HIGH|MAJOR|MEDIUM)\]/i,
      );
      if (findingMatch) {
        currentIssue = {
          title: line.replace(/^(#+\s*|[-*]\s*)/, "").trim(),
          details: [],
        };
        topIssues.push(currentIssue);
        continue;
      }

      // Capture details for the current top issue (up to next header)
      if (currentIssue && line.match(/^#+/)) {
        currentIssue = null;
      } else if (currentIssue && line) {
        if (line.startsWith("**Location**:") || line.startsWith("**Issue**:")) {
          currentIssue.details.push(line);
        }
      }
    }

    let finalComment = `🤖 **AI Code Review Summary**\n\n`;
    if (summaryText)
      finalComment += `### 📝 Overview\n${summaryText.trim()}\n\n`;

    if (topIssues.length > 0) {
      finalComment += `### Top Findings\n\n`;
      topIssues.forEach((issue) => {
        finalComment += `#### ${issue.title}\n`;
        issue.details.forEach((detail) => {
          finalComment += `- ${detail}\n`;
        });
        finalComment += `\n`;
      });
    } else {
      finalComment += `✅ No critical or high-priority issues identified.\n\n`;
    }

    return finalComment;
  }

  /**
   * Creates and injects the review panel into the page.
   */
  function createPanel() {
    const panel = document.createElement("div");
    panel.id = "ai-review-panel";
    panel.innerHTML = `
      <div id="ai-review-header">
        <span>🤖 AI Code Review</span>
        <button id="ai-review-close" title="Close">✕</button>
      </div>
      <div id="ai-review-body">
        <div id="ai-review-content">Click "Review PR with AI" to start.</div>
      </div>
    `;
    document.body.appendChild(panel);

    document.getElementById("ai-review-close").addEventListener("click", () => {
      panel.classList.remove("open");
    });

    return panel;
  }

  /**
   * Injects the "Review PR with AI" button into the PR page toolbar.
   */
  function injectButton() {
    // Try to place it near the PR action buttons area
    const target =
      document.querySelector(".gh-header-actions") ||
      document.querySelector(".TableObject-item--primary") ||
      document.querySelector("#partial-discussion-header .gh-header-show");

    if (!target) return;

    const btn = document.createElement("button");
    btn.id = "ai-review-btn";
    btn.textContent = "🤖 Review PR with AI";
    btn.title = "Get an AI-powered code review using Gemini";

    btn.addEventListener("click", async () => {
      const panel = document.getElementById("ai-review-panel") || createPanel();
      const content = document.getElementById("ai-review-content");

      panel.classList.add("open");

      // If not on Files Changed tab, prompt user
      const diff = extractDiff();
      if (!diff) {
        content.innerHTML = `
          <p>⚠️ No diff found. Please switch to the <strong>Files changed</strong> tab first, then click the button again.</p>
        `;
        return;
      }

      content.innerHTML = `<div class="ai-review-loading">Running ONDC frontend review on ${countFiles(diff)} file(s)...</div>`;
      btn.disabled = true;

      try {
        const prTitle = getPRTitle();
        const prParts = parsePRUrl(window.location.href);
        const headSha = getHeadSha();
        const prKey = prParts
          ? `review_${prParts.owner}_${prParts.repo}_${prParts.number}`
          : null;
        const reviewKey = prParts
          ? `review_${prParts.owner}_${prParts.repo}_${prParts.number}${headSha ? `_${headSha}` : ""}`
          : null;

        // Same commit — return cached review immediately
        if (reviewKey) {
          const cached = await chrome.storage.local.get(reviewKey);
          if (cached[reviewKey]) {
            content.innerHTML = `<div class="ai-review-result">${renderMarkdown(cached[reviewKey])}</div>`;
            content.innerHTML += `<p class="ai-review-success">ℹ️ Showing cached review for this commit.</p>`;
            btn.disabled = false;
            return;
          }
        }

        // New commit — load previous PR-level review as context
        let previousReview = "";
        if (prKey) {
          const stored = await chrome.storage.local.get(prKey);
          if (stored[prKey]) previousReview = stored[prKey];
        }

        const review = await fetchGeminiReview(diff, prTitle, previousReview);

        // Cache under commit key and update PR-level key for next commit
        if (reviewKey) await chrome.storage.local.set({ [reviewKey]: review });
        if (prKey) await chrome.storage.local.set({ [prKey]: review });

        content.innerHTML = `<div class="ai-review-result">${renderMarkdown(review)}</div>`;

        // Automatically post summary to GitHub PR
        if (prParts) {
          const summary = extractReviewSummary(review);
          const statusEl = document.createElement("p");
          statusEl.className = "ai-review-status";
          statusEl.textContent = "📤 Posting summary to PR comments...";
          content.appendChild(statusEl);

          try {
            const response = await new Promise((resolve) => {
              chrome.runtime.sendMessage(
                {
                  action: "POST_GITHUB_COMMENT",
                  owner: prParts.owner,
                  repo: prParts.repo,
                  prNumber: prParts.number,
                  body: summary,
                },
                resolve,
              );
            });

            statusEl.remove();
            if (response && response.success) {
              content.innerHTML += `<p class="ai-review-success">✅ Summary posted to PR comments.</p>`;
            } else {
              const errMsg = response ? response.error : "Unknown error";
              console.error("Failed to post PR comment:", errMsg);
              content.innerHTML += `<p class="ai-review-error">⚠️ Couldn't post summary comment: ${errMsg}</p>`;
            }
          } catch (sendErr) {
            statusEl.remove();
            console.error("Message passing error:", sendErr);
            content.innerHTML += `<p class="ai-review-error">❌ Extension communication error. Please reload the extension.</p>`;
          }
        } else {
          console.warn(
            "Could not parse PR URL for commenting:",
            window.location.href,
          );
          content.innerHTML += `<p class="ai-review-error">⚠️ Could not identify PR number from URL. Commenting skipped.</p>`;
        }
      } catch (err) {
        content.innerHTML = `<p class="ai-review-error">❌ Error: ${err.message}</p>`;
      } finally {
        btn.disabled = false;
      }
    });

    target.prepend(btn);
  }

  function countFiles(diff) {
    return (diff.match(/^--- /gm) || []).length;
  }

  // GitHub uses SPA navigation — observe DOM changes to re-inject on navigation
  function init() {
    injectButton();
    if (!document.getElementById("ai-review-panel")) createPanel();
  }

  // Run on load
  init();

  // Re-run on GitHub's SPA navigation (pjax/turbo)
  document.addEventListener("pjax:end", init);
  document.addEventListener("turbo:render", init);
})();
