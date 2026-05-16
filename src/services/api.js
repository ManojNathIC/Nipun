// Nipun - Shared API Service

const GEMINI_API_KEY = "";

/**
 * Calls Google Gemini API to rewrite or chat.
 * @param {string} prompt - The user prompt.
 * @returns {Promise<string>} - The improved text or response.
 */
async function fetchGeminiResponse(prompt) {
  // A prioritized list of models to try in case of failure or high demand
  const MODELS = ["gemini-3.1-flash-lite-preview", "gemini-3-flash-preview"];

  let lastError = null;

  for (const model of MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `Rewrite the following text to be professional, grammatically correct, and clear.
                RULES:
                1. Output ONLY the improved text string.
                2. Do NOT include any introductory, concluding, or meta-commentary.
                3. Do NOT include multiple options or markdown explanations.
                4. Maintain the original tone unless specified otherwise.
                
                TEXT: "${prompt}"`,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.1, // Near-deterministic for consistency
            topP: 0.95,
            topK: 40
          }
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        const errorMessage = errorData.error?.message || "Unknown error";

        if (
          response.status === 503 ||
          response.status === 429 ||
          errorMessage.includes("high demand")
        ) {
          console.warn(
            `Model ${model} failed (${response.status}). Trying next fallback...`,
          );
          lastError = new Error(errorMessage);
          continue;
        }

        throw new Error(errorMessage);
      }

      const data = await response.json();

      if (
        data.candidates &&
        data.candidates[0].content &&
        data.candidates[0].content.parts
      ) {
        return data.candidates[0].content.parts[0].text;
      }

      throw new Error("Invalid response format from API.");
    } catch (error) {
      console.error(`Attempt with ${model} failed:`, error);
      lastError = error;
      continue;
    }
  }

  throw (
    lastError ||
    new Error(
      "All AI models are currently unavailable. Please try again later.",
    )
  );
}

/**
 * Loads review config from chrome.storage.local.
 * Falls back to the bundled review-config.json if none is saved.
 * @returns {Promise<{projectContext: string, checklist: string[], outputFormat: string}>}
 */
async function loadReviewConfig() {
  const stored = await chrome.storage.local.get("reviewConfig");
  if (stored.reviewConfig) return stored.reviewConfig;

  // Fallback: fetch the bundled default config
  const url = chrome.runtime.getURL("review-config.json");
  const res = await fetch(url);
  return await res.json();
}

/**
 * Builds the review prompt from config + diff.
 * @param {object} config
 * @param {string} diff
 * @param {string} prTitle
 * @param {string} previousReview
 * @returns {string}
 */
function buildReviewPrompt(config, diff, prTitle, previousReview, isIncremental = false, filesInDiff = []) {
  const checklist = config.checklist
    .map((item, i) => `**${i + 1}.** ${item}`)
    .join("\n");

  const filesInDiffText = filesInDiff.length > 0 
    ? `\n**Files included in this diff batch**: \n- ${filesInDiff.join("\n- ")}`
    : "";

  return `${config.projectContext}

## CRITICAL INSTRUCTIONS
1. **STRICT ISOLATION**: You are reviewing a specific set of changes (a diff) from a Pull Request. You MUST ONLY review the code provided in the diff below. Do NOT assume the state of any file not present in this diff. Do NOT report new issues in other files or based on previous knowledge of this codebase.
2. **SCOPE**: Only review the modified lines and their immediate context. Do NOT comment on parts of the file that have not been changed.
${isIncremental ? "3. **INCREMENTAL DIFF**: This is an incremental diff showing only the changes made since the last review. Files not shown here have not changed since then.\n" : ""}
${filesInDiffText}

${
  previousReview
    ? `## PREVIOUS REVIEW FINDINGS
The following issues were raised in the last review of this PR. You MUST begin your response with a "## Previous Findings Status" section.
**RULES FOR PREVIOUS FINDINGS**:
- **Check every item** from the previous review list.
- If a finding is for a file that IS in the current diff list above, verify if it is ✅ FIXED or ❌ STILL OPEN (and check for new mistakes in the fix).
- If a finding is for a file that IS NOT in the current diff list above, mark it as "❌ STILL OPEN (file not modified in this push)".
- Do NOT "re-review" untouched files—just report their status based on the diff availability.

\`\`\`
${previousReview}
\`\`\`
`
    : ""
}
${prTitle ? `PR Title: "${prTitle}"\n` : ""}
## Code to review (STRICT SCOPE)
\`\`\`
${diff}
\`\`\`

---

## Checklist
${checklist}

---

## Output format
${config.outputFormat}`;
}

/**
 * Calls Google Gemini API for code review.
 * @param {string} diff - The PR diff or pasted code/file content.
 * @param {string} prTitle - The PR title for context.
 * @param {string} previousReview - Optional findings from the last review to verify fixes.
 * @param {boolean} isIncremental - Whether this is an incremental diff since the last push.
 * @param {string[]} filesInDiff - List of filenames present in the current diff.
 * @returns {Promise<string>} - The structured review markdown.
 */
async function fetchGeminiReview(diff, prTitle = "", previousReview = "", isIncremental = false, filesInDiff = []) {
  const MODELS = ["gemini-3.1-flash-lite-preview", "gemini-3-flash-preview"];

  const config = await loadReviewConfig();
  const prompt = buildReviewPrompt(config, diff, prTitle, previousReview, isIncremental, filesInDiff);
  let lastError = null;

  for (const model of MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0, // Maximum consistency for code reviews
            topP: 1,
            topK: 1
          }
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        lastError = new Error(errorData.error?.message || "Unknown error");
        continue;
      }

      const data = await response.json();
      if (data.candidates?.[0]?.content?.parts) {
        return data.candidates[0].content.parts[0].text;
      }
      throw new Error("Invalid response format from API.");
    } catch (error) {
      lastError = error;
      continue;
    }
  }

  throw lastError || new Error("All AI models are currently unavailable.");
}
