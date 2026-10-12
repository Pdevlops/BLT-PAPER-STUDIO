import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(__dirname));

const PORT = Number(process.env.PORT || 3000);
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const OLLAMA_URL = (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:3b";

const instructions = `You are an expert university assessment designer using Revised Bloom's Taxonomy. Classify the cognitive work the student must perform in the COMPLETE question, not merely the topic or action verb.
Taxonomy mapping (these pairs MUST match exactly): 1=Remember; 2=Understand; 3=Apply; 4=Analyze; 5=Evaluate; 6=Create.
Definitions: 1 recall facts; 2 explain/interpret meaning; 3 use a known method in a situation; 4 examine parts, evidence, causes, patterns or relationships to identify/diagnose issues; 5 make and justify a judgment against explicit or implicit criteria; 6 design or produce a new solution/product.
Calibration examples:
- "Define normalization." => level 1, Remember.
- "Explain the purpose of normalization." => level 2, Understand.
- "Apply 2NF to the following table." => level 3, Apply.
- "Analyze the given database schema and identify normalization problems." => level 4, Analyze.
- "Evaluate two database designs against the requirements and justify which is better." => level 5, Evaluate.
- "Design a normalized database schema for a hospital system." => level 6, Create.
Important: identifying/diagnosing problems by examining a schema is Analyze (4), not Evaluate (5), unless the question asks for a criteria-based judgment. The word "understand" in your explanation does not make the level Understand. Before returning, verify that the numeric level and levelName correspond to the mapping above. Never return level 5 with levelName Analyze, or any other mismatch.
Return exactly one JSON object with: level (integer 1-6), levelName, primaryCognitiveAction, reason (brief and specific), confidence (High, Medium, or Low), reviewRequired (boolean). If incomplete, ambiguous, compound with different levels, or lacking context, choose the best provisional level and set reviewRequired=true. Confidence is qualitative, not a probability.`;

function validateResult(result, question) {
  const names = { 1: "Remember", 2: "Understand", 3: "Apply", 4: "Analyze", 5: "Evaluate", 6: "Create" };
  const levelByName = Object.fromEntries(Object.entries(names).map(([n, name]) => [name.toLowerCase(), Number(n)]));
  let level = Number(result.level);
  if (!Number.isInteger(level) || level < 1 || level > 6) throw new Error("The AI returned an invalid BTL value. Please retry.");
  // If the model contradicts itself (e.g. level 5 but name Analyze), prefer its valid taxonomy name
  // and force the displayed number/name pair to agree. This fixes formatting inconsistency, not all semantic errors.
  const statedName = String(result.levelName || "").trim().toLowerCase();
  if (levelByName[statedName] && levelByName[statedName] !== level) level = levelByName[statedName];
  return {
    questionText: question,
    level,
    levelName: names[level],
    primaryCognitiveAction: String(result.primaryCognitiveAction || "Review the task required by the question."),
    reason: String(result.reason || "Review this classification against the intended learning outcome."),
    confidence: ["High", "Medium", "Low"].includes(result.confidence) ? result.confidence : "Low",
    reviewRequired: Boolean(result.reviewRequired ?? true),
    provider: OPENAI_KEY ? "OpenAI" : "Ollama (local)"
  };
}

async function classifyWithOllama(payload) {
  let response;
  try {
    response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        format: "json",
        messages: [
          { role: "system", content: instructions },
          { role: "user", content: JSON.stringify(payload) }
        ],
        options: { temperature: 0.1 }
      }),
      signal: AbortSignal.timeout(120000)
    });
  } catch {
    const error = new Error(`Free local AI is not running. Install Ollama, then run: ollama pull ${OLLAMA_MODEL}. Keep Ollama running and retry. Setup guide: https://ollama.com/download`);
    error.status = 503;
    throw error;
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body?.error || `Ollama returned HTTP ${response.status}`;
    const error = new Error(detail.includes("not found") ? `The local model ${OLLAMA_MODEL} is not installed. Open a terminal and run: ollama pull ${OLLAMA_MODEL}` : `Local AI error: ${detail}`);
    error.status = 503;
    throw error;
  }
  let result;
  try { result = JSON.parse(body?.message?.content || ""); }
  catch { throw new Error("The local AI returned an unreadable result. Please retry."); }
  return result;
}

async function classifyWithOpenAI(payload) {
  const upstream = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: OPENAI_MODEL, instructions, input: JSON.stringify(payload), text: { format: { type: "json_object" } }, max_output_tokens: 350 }),
    signal: AbortSignal.timeout(60000)
  });
  const body = await upstream.json().catch(() => ({}));
  if (!upstream.ok) throw new Error(body?.error?.message || `AI provider error ${upstream.status}`);
  const text = (body.output || []).flatMap(x => x.content || []).filter(x => x.type === "output_text").map(x => x.text).join("");
  try { return JSON.parse(text); }
  catch { throw new Error("AI returned an unreadable result. Please retry."); }
}

app.get("/api/health", async (_req, res) => {
  if (OPENAI_KEY) return res.json({ ok: true, provider: "OpenAI", model: OPENAI_MODEL });
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2500) });
    const body = await r.json();
    const models = (body.models || []).map(m => m.name);
    return res.json({ ok: true, provider: "Ollama (local)", model: OLLAMA_MODEL, modelInstalled: models.some(m => m === OLLAMA_MODEL || m.startsWith(`${OLLAMA_MODEL.split(":")[0]}:`)) });
  } catch {
    return res.status(503).json({ ok: false, provider: "Ollama (local)", model: OLLAMA_MODEL, message: "Ollama is not running. Install it and run the model download command in README.md." });
  }
});

app.post("/api/classify", async (req, res) => {
  try {
    const { question, taxonomy, courseTitle, outcomes } = req.body || {};
    if (typeof question !== "string" || question.trim().length < 12) return res.status(400).json({ error: "Enter the complete question first." });
    const payload = { question: question.trim(), courseTitle: courseTitle || "", courseOutcomes: outcomes || [], taxonomy: taxonomy || [] };
    const result = OPENAI_KEY ? await classifyWithOpenAI(payload) : await classifyWithOllama(payload);
    return res.json(validateResult(result, question));
  } catch (e) {
    console.error("BTL classification error:", e.message);
    return res.status(e.status || 502).json({ error: e.message || "AI classification failed. Check that the local AI is running and try again." });
  }
});

app.listen(PORT, () => console.log(`BTL Paper Studio: http://localhost:${PORT}
AI mode: ${OPENAI_KEY ? `OpenAI (${OPENAI_MODEL})` : `free local Ollama (${OLLAMA_MODEL})`}`));
