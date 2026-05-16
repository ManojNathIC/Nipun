// Nipun - PostHog Integration
// Used to persist and retrieve PR reviews across sessions

var POSTHOG_API_KEY = "";
var POSTHOG_PERSONAL_API_KEY = "";
var POSTHOG_PROJECT_ID = "";
var POSTHOG_HOST = "https://us.i.posthog.com";

/**
 * Gets the currently authenticated GitHub username via the API.
 * @returns {Promise<string>}
 */
async function getGitHubUsername() {
  try {
    const headers = { Accept: "application/vnd.github+json" };
    if (typeof GITHUB_TOKEN !== "undefined" && GITHUB_TOKEN) {
      headers["Authorization"] = `Bearer ${GITHUB_TOKEN}`;
    }
    const res = await fetch("https://api.github.com/user", { headers });
    if (!res.ok) return "unknown";
    const data = await res.json();
    return data.login || "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Returns a cached review for an exact commit key, or null if not found.
 * Used to avoid re-running Gemini on the same commit.
 * @param {string} reviewKey - e.g. "owner_repo_123_abc123sha"
 * @returns {Promise<string|null>}
 */
async function getCachedReview(reviewKey) {
  try {
    const stored = await chrome.storage.local.get(`review_${reviewKey}`);
    const entry = stored[`review_${reviewKey}`];
    if (!entry) return null;
    return typeof entry === "string" ? entry : entry.review;
  } catch (err) {
    console.warn("Nipun Error: [LocalStorage] Cache read error:", err);
    return null;
  }
}

/**
 * Captures a pr_reviewed event in PostHog with the full review text.
 * @param {string} reviewKey - Commit-scoped key e.g. "owner_repo_123_abc123sha"
 * @param {string} prUrl - Full PR URL
 * @param {string} reviewText - The full Gemini review markdown
 * @param {string} prAuthor
 * @param {string} prKey - PR-level key e.g. "owner_repo_123" (for cross-commit context)
 */
async function captureReviewEvent(
  reviewKey,
  prUrl,
  reviewText,
  prAuthor,
  prKey,
  headSha,
) {
  // Cache under commit-scoped key (for same-commit cache hit)
  try {
    await chrome.storage.local.set({
      [`review_${reviewKey}`]: { review: reviewText, sha: headSha },
    });
    console.log("[LocalStorage] Review cached for commit:", reviewKey);
  } catch (err) {
    console.warn("Nipun Error: [LocalStorage] Write error:", err);
  }

  // Also store under PR-level key so the next commit can load this as previous context
  if (prKey && prKey !== reviewKey) {
    try {
      await chrome.storage.local.set({
        [`review_${prKey}`]: { review: reviewText, sha: headSha },
      });
      console.log("[LocalStorage] Review cached for PR:", prKey);
    } catch (err) {
      console.warn("Nipun Error: [LocalStorage] PR-level write error:", err);
    }
  }

  if (!POSTHOG_API_KEY) return;

  const reviewer = await getGitHubUsername();

  const res = await fetch(`${POSTHOG_HOST}/capture/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: POSTHOG_API_KEY,
      event: "pr_reviewed",
      distinct_id: reviewer,
      properties: {
        pr_key: prKey,
        pr_url: prUrl,
        review_text: reviewText,
        head_sha: headSha,
        reviewer_username: reviewer,
        pr_author_username: prAuthor || "unknown",
        $process_person_profile: false,
      },
    }),
  });

  if (!res.ok) {
    console.warn("Nipun Error: [PostHog] Capture failed:", res.status, await res.text());
  } else {
    console.log(
      "[PostHog] Review captured — reviewer:",
      reviewer,
      "| PR author:",
      prAuthor,
    );
  }
}

/**
 * Fetches the most recent review for a PR (cross-commit context).
 * Reads from the PR-level key (owner_repo_number), not commit-scoped.
 * Falls back to PostHog if not in local storage.
 * @param {string} prKey - e.g. "owner_repo_123"
 * @returns {Promise<string>}
 */
async function fetchPreviousReview(prKey) {
  // Primary: check local storage — always scoped to the correct PR
  try {
    const stored = await chrome.storage.local.get(`review_${prKey}`);
    const localEntry = stored[`review_${prKey}`];
    if (localEntry) {
      console.log("[LocalStorage] Previous review found for PR:", prKey);
      return typeof localEntry === "string"
        ? { review: localEntry, sha: null }
        : localEntry;
    }
  } catch (err) {
    console.warn("Nipun Error: [LocalStorage] Read error:", err);
  }

  // Fallback: PostHog query
  if (!POSTHOG_PERSONAL_API_KEY || !POSTHOG_PROJECT_ID) {
    console.warn(
      "Nipun Error: [PostHog] Missing personal API key or project ID — skipping previous review fetch.",
    );
    return "";
  }

  const safePrKey = prKey.replace(/'/g, "\\'");
  const sql = `SELECT properties.review_text, properties.pr_key, properties.head_sha FROM events WHERE event = 'pr_reviewed' AND properties.pr_key = '${safePrKey}' ORDER BY timestamp DESC LIMIT 5`;

  try {
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

    const data = await res.json();
    console.log("[PostHog] Query status:", res.status);

    if (!res.ok) {
      console.warn("Nipun Error: [PostHog] Query failed:", data);
      return "";
    }

    // Explicitly verify pr_key matches to prevent cross-PR bleed
    const results = data?.results || [];
    const match = results.find((row) => row[1] === prKey);
    const review = match ? match[0] : null;
    const sha = match ? match[2] : null;

    console.log("[PostHog] Previous review found:", !!review);
    return { review: review || "", sha: sha || null };
  } catch (err) {
    console.error("Nipun Error:", err);
    return "";
  }
}
