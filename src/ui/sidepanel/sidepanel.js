// Nipun - Side Panel Logic

// Injected at build time from .env
const MIN_SEVERITY_TO_BLOCK = "medium"; // controls PR comment filter only — sidepanel always shows all
const POST_REVIEW_COMMENT = true;
const AI_DISPLAY_NAME = "Nipun";

// Severity order for filtering — lower index = higher severity
const SEVERITY_ORDER = ["critical", "major", "medium", "minor", "suggestion"];

const prUrlInput = document.getElementById("sp-pr-url");
const reviewBtn = document.getElementById("sp-review-btn");
const reviewOutput = document.getElementById("sp-review-output");

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

/**
 * Extracts a summary of top findings from the markdown review.
 * Matches Summary and Findings sections flexibly.
 */
function extractReviewSummary(review) {
  const lines = review.split("\n");
  const topIssues = [];
  let summaryText = "";
  let verdictLine = "";
  let verdictSummary = "";
  let inSummary = false;
  let inVerdict = false;
  let inPreviousFindings = false;
  let previousFindingsLines = [];
  let currentIssue = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Previous Findings Status extraction
    if (line.match(/^(#+\s*)?Previous Findings Status/i)) {
      inPreviousFindings = true;
      inSummary = false;
      inVerdict = false;
      continue;
    }
    if (inPreviousFindings) {
      if (
        line.match(/^#+/) &&
        !line.match(/^(#+\s*)?Previous Findings Status/i)
      ) {
        inPreviousFindings = false;
      } else if (line) {
        previousFindingsLines.push(line);
        continue;
      } else {
        continue;
      }
    }

    // Merge Verdict Extraction
    if (line.match(/^(#+\s*)?Merge verdict/i)) {
      inVerdict = true;
      inSummary = false;
      continue;
    }
    if (inVerdict) {
      if (line.match(/^#+/)) {
        inVerdict = false;
      } else if (line) {
        if (!verdictLine) {
          verdictLine = line;
        } else {
          verdictSummary += line + " ";
        }
      }
      if (line.match(/^#+/)) inVerdict = false;
      else continue;
    }

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
    const minIndex = SEVERITY_ORDER.indexOf(
      MIN_SEVERITY_TO_BLOCK.toLowerCase(),
    );
    const findingMatch = line.match(
      /^(#+\s*|[-*]\s*)?\[(CRITICAL|HIGH|MAJOR|MEDIUM|MINOR|SUGGESTION)\]/i,
    );
    if (findingMatch) {
      const foundSeverity = findingMatch[2]
        .toLowerCase()
        .replace("high", "critical");
      const foundIndex = SEVERITY_ORDER.indexOf(foundSeverity);
      if (foundIndex !== -1 && foundIndex <= minIndex) {
        currentIssue = {
          title: line.replace(/^(#+\s*|[-*]\s*)/, "").trim(),
          details: [],
        };
        topIssues.push(currentIssue);
      } else {
        currentIssue = null;
      }
      continue;
    }

    if (currentIssue && line.match(/^#+/)) {
      currentIssue = null;
    } else if (currentIssue && line) {
      if (line.startsWith("**Location**:") || line.startsWith("**Issue**:")) {
        currentIssue.details.push(line);
      }
    }
  }

  let finalComment = `# 🤖 AI Review by ${AI_DISPLAY_NAME}\n\n`;

  if (verdictLine) {
    const emoji = verdictLine.includes("NOT READY")
      ? "🚫"
      : verdictLine.includes("CHANGES REQUESTED")
        ? "⚠️"
        : "✅";
    finalComment += `### ${emoji} Merge Verdict\n**${verdictLine}**\n`;
    if (verdictSummary.trim()) finalComment += `${verdictSummary.trim()}\n`;
    finalComment += `\n`;
  }

  if (previousFindingsLines.length > 0) {
    finalComment += `### 🔁 Previous Findings Status\n\n`;
    previousFindingsLines.forEach((l) => {
      finalComment += `${l}\n`;
    });
    finalComment += `\n`;
  }

  if (summaryText) finalComment += `### 📝 Overview\n${summaryText.trim()}\n\n`;

  if (topIssues.length > 0) {
    finalComment += `### 🚩 Top Findings\n\n`;
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

  finalComment += `---\n*This review was generated by **${AI_DISPLAY_NAME}**, an AI assistant powered by Google Gemini. Please verify all findings before merging.*`;

  return finalComment;
}

function setStatus(msg) {
  reviewOutput.innerHTML = `<div class="sp-loading">${msg}</div>`;
}

async function handleReview() {
  const url = prUrlInput.value.trim();
  if (!url) return;

  const pr = parsePRUrl(url);
  if (!pr) {
    reviewOutput.innerHTML = `<p class="sp-error">❌ Invalid GitHub PR URL. Expected: https://github.com/owner/repo/pull/123</p>`;
    return;
  }

  reviewBtn.disabled = true;

  try {
    setStatus("Fetching PR metadata...");
    const meta = await fetchPRMeta(pr.owner, pr.repo, pr.number);

    setStatus("Fetching changed files...");
    const files = await fetchPRFiles(pr.owner, pr.repo, pr.number);

    let reviewableFiles = files.filter((f) => f.patch);
    if (reviewableFiles.length === 0) {
      reviewOutput.innerHTML = `<p class="sp-error">⚠️ No reviewable diffs found (PR may only contain binary or renamed files).</p>`;
      return;
    }

    let fullReview = "";

    // Key by commit SHA so re-reviews on new commits don't pull stale previous review
    const prKey = `${pr.owner}_${pr.repo}_${pr.number}`;
    const reviewKey = meta.headSha
      ? `${pr.owner}_${pr.repo}_${pr.number}_${meta.headSha}`
      : prKey;

    // Check if we already have a cached review for this exact commit — return it immediately
    setStatus("Checking previous review...");
    const cachedReview = await getCachedReview(reviewKey);
    if (cachedReview) {
      reviewOutput.innerHTML = `
        <div class="sp-review-meta">
          <strong>${meta.title}</strong>
          <span>${reviewableFiles.length} file(s) • cached review for this commit</span>
        </div>
        <div class="sp-review-result">${renderMarkdown(cachedReview)}</div>
      `;
      reviewBtn.disabled = false;
      return;
    }

    // New commit — load previous PR-level review + SHA as context
    const previousEntry = await fetchPreviousReview(prKey);
    const previousReview = previousEntry?.review || "";
    const previousSha = previousEntry?.sha || null;

    // If we have a previous SHA, fetch only files changed since that commit
    let isIncremental = false;
    if (previousSha && meta.headSha && previousSha !== meta.headSha) {
      setStatus("Fetching incremental diff since last review...");
      try {
        const incrementalFiles = await fetchCommitRangeDiff(
          pr.owner, pr.repo, previousSha, meta.headSha
        );
        if (incrementalFiles.length > 0) {
          reviewableFiles = incrementalFiles;
          isIncremental = true;
          console.log(`[Review] Incremental: ${reviewableFiles.length} file(s) changed since ${previousSha}`);
        }
      } catch (err) {
        console.warn("[Review] Incremental diff failed, using full PR diff:", err.message);
      }
    }

    const chunks = chunkFiles(reviewableFiles);
    const totalChunks = chunks.length;

    for (let i = 0; i < totalChunks; i++) {
      setStatus(
        totalChunks > 1
          ? `Reviewing batch ${i + 1} of ${totalChunks} (${chunks[i].length} files)...`
          : `Running ONDC frontend review on ${reviewableFiles.length} file(s)...`,
      );

      const diff = buildDiffText(chunks[i]);
      const chunkFilesList = chunks[i].map((f) => f.filename);
      const chunkTitle =
        totalChunks > 1
          ? `${meta.title} [Part ${i + 1}/${totalChunks}]`
          : meta.title;

      const result = await fetchGeminiReview(diff, chunkTitle, previousReview, isIncremental, chunkFilesList);
      fullReview +=
        (totalChunks > 1 ? `\n\n## Batch ${i + 1}/${totalChunks}\n` : "") +
        result;
    }

    // Save review — keyed by commit SHA for cache, also stored under prKey for next commit's context
    await captureReviewEvent(reviewKey, url, fullReview, meta.author, prKey, meta.headSha);

    reviewOutput.innerHTML = `
      <div class="sp-review-meta">
        <strong>${meta.title}</strong>
        <span>${reviewableFiles.length} file(s) reviewed${totalChunks > 1 ? ` in ${totalChunks} batches` : ""}</span>
      </div>
      <div class="sp-review-result">${renderMarkdown(fullReview)}</div>
    `;

    // Post summary to GitHub PR if enabled
    if (POST_REVIEW_COMMENT) {
      const statusEl = document.createElement("div");
      statusEl.className = "sp-loading";
      statusEl.style.padding = "10px 0";
      statusEl.textContent = "📤 Posting summary to PR comments...";
      reviewOutput.appendChild(statusEl);

      try {
        const summary = extractReviewSummary(fullReview);
        await postPRComment(pr.owner, pr.repo, pr.number, summary);

        statusEl.remove();
        const successMsg = document.createElement("p");
        successMsg.className = "sp-success";
        successMsg.textContent = "✅ Summary posted to PR successfully.";
        reviewOutput.appendChild(successMsg);
      } catch (postErr) {
        statusEl.remove();
        console.error("Failed to post comment:", postErr);
        const errMsg = document.createElement("p");
        errMsg.className = "sp-error";
        errMsg.textContent = `⚠️ Review complete, but failed to post comment: ${postErr.message}`;
        reviewOutput.appendChild(errMsg);
      }
    }
  } catch (err) {
    reviewOutput.innerHTML = `<p class="sp-error">❌ ${err.message}</p>`;
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

prUrlInput.focus();

// --- Review Config ---
const configInput = document.getElementById("sp-config-input");
const configSaveBtn = document.getElementById("sp-config-save");
const configResetBtn = document.getElementById("sp-config-reset");
const configStatus = document.getElementById("sp-config-status");

// Load saved config into textarea on open
chrome.storage.local.get("reviewConfig", ({ reviewConfig }) => {
  if (reviewConfig) {
    configInput.value = JSON.stringify(reviewConfig, null, 2);
  }
});

configSaveBtn.addEventListener("click", () => {
  try {
    const parsed = JSON.parse(configInput.value);
    const required = ["projectContext", "checklist", "outputFormat"];
    const missing = required.filter((k) => !(k in parsed));
    if (missing.length)
      throw new Error(`Missing fields: ${missing.join(", ")}`);

    chrome.storage.local.set({ reviewConfig: parsed }, () => {
      configStatus.textContent = "✅ Config saved.";
      configStatus.style.color = "green";
      setTimeout(() => (configStatus.textContent = ""), 3000);
    });
  } catch (e) {
    configStatus.textContent = `❌ Invalid JSON: ${e.message}`;
    configStatus.style.color = "red";
  }
});

configResetBtn.addEventListener("click", () => {
  chrome.storage.local.remove("reviewConfig", () => {
    configInput.value = "";
    configStatus.textContent = "↩ Reset to default config.";
    configStatus.style.color = "gray";
    setTimeout(() => (configStatus.textContent = ""), 3000);
  });
});

// --- Tab switching ---
document.querySelectorAll(".sp-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document
      .querySelectorAll(".sp-tab")
      .forEach((t) => t.classList.remove("active"));
    document
      .querySelectorAll(".sp-tab-content")
      .forEach((c) => c.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add("active");
  });
});

// --- Insights ---
const insightsBtn = document.getElementById("sp-insights-btn");
const insightsAuthorInput = document.getElementById("sp-insights-author");
const insightsOutput = document.getElementById("sp-insights-output");

insightsBtn.addEventListener("click", handleInsights);
insightsAuthorInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleInsights();
});

async function handleInsights() {
  const author = insightsAuthorInput.value.trim();
  insightsBtn.disabled = true;
  insightsOutput.innerHTML = `<div class="sp-loading">Fetching review history from PostHog...</div>`;

  try {
    const events = await fetchAllReviewEvents(author);

    if (!events.length) {
      insightsOutput.innerHTML = `<p class="sp-error">No review data found${author ? ` for @${author}` : ""}.</p>`;
      return;
    }

    insightsOutput.innerHTML = `<div class="sp-loading">Analysing ${events.length} review(s) with AI...</div>`;
    const insight = await fetchGeminiInsights(events, author);
    insightsOutput.innerHTML = `<div class="sp-review-result" style="padding:14px">${renderMarkdown(insight)}</div>`;
  } catch (err) {
    insightsOutput.innerHTML = `<p class="sp-error">❌ ${err.message}</p>`;
  } finally {
    insightsBtn.disabled = false;
  }
}

/**
 * Fetches all pr_reviewed events from PostHog, optionally filtered by PR author.
 */
async function fetchAllReviewEvents(author) {
  const whereAuthor = author
    ? `AND properties.pr_author_username = '${author.replace(/'/g, "\\'")}'`
    : "";

  const sql = `
    SELECT
      properties.pr_author_username,
      properties.reviewer_username,
      properties.review_text,
      properties.pr_url,
      timestamp
    FROM events
    WHERE event = 'pr_reviewed'
      ${whereAuthor}
    ORDER BY timestamp DESC
    LIMIT 100
  `;

  const res = await fetch(
    `${POSTHOG_HOST}/api/projects/${POSTHOG_PROJECT_ID}/query/`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${POSTHOG_PERSONAL_API_KEY}`,
      },
      body: JSON.stringify({ query: { kind: "HogQLQuery", query: sql } }),
    },
  );

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || `PostHog query failed: ${res.status}`);
  }

  const data = await res.json();
  return (data.results || []).map(
    ([prAuthor, reviewer, reviewText, prUrl, timestamp]) => ({
      prAuthor,
      reviewer,
      reviewText: reviewText || "",
      prUrl,
      timestamp,
    }),
  );
}

/**
 * Sends all review history to Gemini and gets AI-powered behavioural insights.
 */
async function fetchGeminiInsights(events, filterAuthor) {
  const MODELS = ["gemini-3.1-flash-lite-preview", "gemini-3-flash-preview"];

  // Build a compact summary of each review to stay within token limits
  const reviewSummaries = events
    .map((e, i) => {
      // Extract just findings lines to keep it concise
      const findings = e.reviewText
        .split("\n")
        .filter((l) =>
          l.match(
            /\[(CRITICAL|MAJOR|MEDIUM|MINOR|SUGGESTION)\]|❌ STILL OPEN|✅ FIXED/i,
          ),
        )
        .slice(0, 20)
        .join("\n");

      return `--- Review ${i + 1} | PR: ${e.prUrl || "unknown"} | Author: ${e.prAuthor || "unknown"} | Reviewer: ${e.reviewer || "unknown"} | Date: ${e.timestamp?.slice(0, 10) || "unknown"} ---\n${findings || e.reviewText.slice(0, 500)}`;
    })
    .join("\n\n");

  const focusLine = filterAuthor
    ? `Focus specifically on the behaviour and patterns of developer @${filterAuthor}.`
    : "Analyse patterns across all developers.";

  const prompt = `You are a senior engineering lead analysing code review history for a team.

Below are ${events.length} PR review(s) from an AI code reviewer. ${focusLine}

${reviewSummaries}

---

Based on this review history, provide a structured analysis with these sections:

## 📊 Overview
A 2-3 sentence summary of the overall code quality trend and team health.

## 🔁 Repeated Mistakes
List the top recurring issues across reviews. For each, explain WHY it keeps happening (knowledge gap, rushed work, missing tooling, etc.) and how serious it is.

## 👤 Developer Behaviour Patterns
For each developer mentioned, describe their specific patterns — what they consistently get wrong, what they've improved, and their overall trajectory.

## 🎯 Actionable Next Steps
Concrete, specific recommendations to prevent these issues from recurring. Think: lint rules, pair programming, documentation, training, process changes. Be specific — not "improve code quality" but "add ESLint rule no-explicit-any to tsconfig strict mode".

## ✅ What's Working
Highlight positive trends — issues that got fixed, improvements over time, good practices being followed.

Keep the tone constructive and coaching-oriented, not punitive.`;

  let lastError = null;
  for (const model of MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      });

      if (!res.ok) {
        const err = await res.json();
        lastError = new Error(err.error?.message || "Unknown error");
        continue;
      }

      const data = await res.json();
      if (data.candidates?.[0]?.content?.parts) {
        return data.candidates[0].content.parts[0].text;
      }
      throw new Error("Invalid response from Gemini.");
    } catch (err) {
      lastError = err;
      continue;
    }
  }
  throw lastError || new Error("All AI models unavailable.");
}
