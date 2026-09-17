/**
 * Getting reliable JSON out of small open-source models.
 *
 * Even with JSON mode, local models sometimes wrap output in ```json fences, add a
 * sentence before it, or get cut off. `extractJson` recovers the JSON value, and the
 * zod schema then validates its shape so the UI never renders malformed data.
 */
import type { z } from "zod";

export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through to recovery strategies
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      // continue
    }
  }

  const start = trimmed.search(/[{[]/);
  if (start < 0) throw new Error("No JSON found in model output.");
  const candidate = balancedSlice(trimmed, start);
  if (candidate) return JSON.parse(candidate);
  // Output was cut off: close any open strings/brackets and try once more.
  return JSON.parse(repairTruncated(trimmed.slice(start)));
}

/** Returns the substring from `start` to its matching closing bracket, if complete. */
function balancedSlice(text: string, start: number): string | null {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
    else if (ch === "}" || ch === "]") {
      stack.pop();
      if (!stack.length) return text.slice(start, i + 1);
    }
  }
  return null;
}

function repairTruncated(text: string): string {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
    else if (ch === "}" || ch === "]") stack.pop();
  }
  let repaired = text;
  if (inString) repaired += '"';
  // Drop a dangling object key without a value ('"key":' or '"key"') and trailing commas.
  repaired = repaired.replace(/,?\s*"[^"]*"\s*:\s*$/, "").replace(/,\s*$/, "");
  if (stack[stack.length - 1] === "}") repaired = repaired.replace(/([{,]\s*)"[^"]*"\s*$/, "$1").replace(/,\s*$/, "");
  return repaired + stack.reverse().join("");
}

export function parseWithSchema<T extends z.ZodType>(text: string, schema: T): z.infer<T> {
  const value = extractJson(text);
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(`Model output did not match the expected format (${issue?.path.join(".") || "root"}: ${issue?.message}).`);
  }
  return result.data;
}
