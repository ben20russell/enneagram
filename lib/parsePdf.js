import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// iEQ9 PDF Parser — Azure OpenAI gpt-5.4-mini (no Anthropic usage).

const SCHEMA = `{
  "clientName": "string",
  "reportDate": "string (ISO if available, else as printed)",
  "primaryType": "integer 1-9",
  "wing": "integer 1-9",
  "instinctualVariant": "string: sp | sx | so",
  "trifix": "string e.g. '8w7 3w2 6w5'",
  "levelOfDevelopment": "integer 1-9 (1 = healthiest)",
  "centreOfIntelligence": "string: Head | Heart | Body",
  "typeScores": {
    "type1": "integer 0-100",
    "type2": "integer 0-100",
    "type3": "integer 0-100",
    "type4": "integer 0-100",
    "type5": "integer 0-100",
    "type6": "integer 0-100",
    "type7": "integer 0-100",
    "type8": "integer 0-100",
    "type9": "integer 0-100"
  },
  "instinctScores": {
    "selfPreservation": "integer 0-100",
    "sexual": "integer 0-100",
    "social": "integer 0-100"
  },
  "centerScores": {
    "head": "integer 0-100",
    "heart": "integer 0-100",
    "body": "integer 0-100"
  },
  "levelScores": {
    "level1": "integer",
    "level2": "integer",
    "level3": "integer",
    "level4": "integer",
    "level5": "integer",
    "level6": "integer",
    "level7": "integer",
    "level8": "integer",
    "level9": "integer"
  },
  "arrowDynamics": {
    "integration": "integer (type moved toward in growth)",
    "disintegration": "integer (type moved toward in stress)"
  },
  "harmoniousGroup": "string: Positive Outlook | Competency | Reactive",
  "hornevianGroup": "string: Compliant | Assertive | Withdrawn",
  "keyStrengths": ["array of 3-6 strings"],
  "keyGrowthAreas": ["array of 3-6 strings"],
  "coreMotivation": "string 1-2 sentences",
  "coreDesire": "string 1-2 sentences",
  "coreFear": "string 1-2 sentences",
  "reportSummary": "string 3-5 sentence synthesis of the full report narrative"
}`;

const SYSTEM_PROMPT = `You are an expert reader of iEQ9 Enneagram assessment reports.
You will receive OCR/text extracted from an iEQ9 PDF report.

Rules:
- Infer chart-derived values from the extracted report text where possible.
- The primary type is the highest-scoring type signal in the report.
- If a field is not present, use null.
- Return ONLY valid JSON. No markdown fences. No preamble.`;

function safeJsonParse(raw) {
  const cleaned = String(raw || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  return JSON.parse(cleaned);
}

function getEmptySchema() {
  return {
    clientName: null,
    reportDate: null,
    primaryType: null,
    wing: null,
    instinctualVariant: null,
    trifix: null,
    levelOfDevelopment: null,
    centreOfIntelligence: null,
    typeScores: {
      type1: null,
      type2: null,
      type3: null,
      type4: null,
      type5: null,
      type6: null,
      type7: null,
      type8: null,
      type9: null,
    },
    instinctScores: {
      selfPreservation: null,
      sexual: null,
      social: null,
    },
    centerScores: {
      head: null,
      heart: null,
      body: null,
    },
    levelScores: {
      level1: null,
      level2: null,
      level3: null,
      level4: null,
      level5: null,
      level6: null,
      level7: null,
      level8: null,
      level9: null,
    },
    arrowDynamics: {
      integration: null,
      disintegration: null,
    },
    harmoniousGroup: null,
    hornevianGroup: null,
    keyStrengths: [],
    keyGrowthAreas: [],
    coreMotivation: null,
    coreDesire: null,
    coreFear: null,
    reportSummary: null,
  };
}

function normalizeParsedShape(raw) {
  const base = getEmptySchema();
  if (!raw || typeof raw !== "object") return base;
  return {
    ...base,
    ...raw,
    typeScores: { ...base.typeScores, ...(raw.typeScores || {}) },
    instinctScores: { ...base.instinctScores, ...(raw.instinctScores || {}) },
    centerScores: { ...base.centerScores, ...(raw.centerScores || {}) },
    levelScores: { ...base.levelScores, ...(raw.levelScores || {}) },
    arrowDynamics: { ...base.arrowDynamics, ...(raw.arrowDynamics || {}) },
    keyStrengths: Array.isArray(raw.keyStrengths) ? raw.keyStrengths : [],
    keyGrowthAreas: Array.isArray(raw.keyGrowthAreas) ? raw.keyGrowthAreas : [],
  };
}

function buildAzureResponsesUrl(endpoint, apiVersion) {
  const base = String(endpoint || "").replace(/\/+$/, "");
  if (base.includes("/openai/responses")) {
    const parsed = new URL(base);
    if (!parsed.searchParams.has("api-version")) {
      parsed.searchParams.set("api-version", apiVersion);
    }
    return parsed.toString();
  }
  if (base.includes("/openai")) {
    return `${base}/responses?api-version=${encodeURIComponent(apiVersion)}`;
  }
  return `${base}/openai/responses?api-version=${encodeURIComponent(apiVersion)}`;
}

function extractTextFromResponsesPayload(payload) {
  if (payload && typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }

  const output = Array.isArray(payload && payload.output) ? payload.output : [];
  const parts = [];
  output.forEach((item) => {
    if (!item || !Array.isArray(item.content)) return;
    item.content.forEach((part) => {
      if (part && typeof part.text === "string") parts.push(part.text);
    });
  });
  return parts.join("\n").trim();
}

function extractFirstJsonObject(text) {
  if (!text) return null;
  const fenceMatch = text.match(/```json\s*([\s\S]*?)```/i);
  const candidate = fenceMatch ? fenceMatch[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

function extractPdfTextWithPython(pdfBuffer) {
  const tmpDir = mkdtempSync(join(tmpdir(), "ieq9-text-"));
  const pdfPath = join(tmpDir, "report.pdf");
  writeFileSync(pdfPath, pdfBuffer);

  try {
    const run = spawnSync(
      "python3",
      [
        "-c",
        [
          "from PyPDF2 import PdfReader",
          "import re, sys",
          "p=sys.argv[1]",
          "text='\\n'.join((pg.extract_text() or '') for pg in PdfReader(p).pages)",
          "text=re.sub(r'\\\\s+',' ',text).strip()",
          "print(text)",
        ].join(";"),
        pdfPath,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 120000,
        maxBuffer: 1024 * 1024 * 32,
      },
    );

    if (run.status !== 0) {
      throw new Error((run.stderr || run.stdout || "Python text extraction failed").trim());
    }

    return String(run.stdout || "").trim();
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function parseViaAzureOpenAI(pdfBuffer) {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT || "";
  const apiKey = process.env.AZURE_OPENAI_API_KEY || "";
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || "2025-04-01-preview";
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT_NAME || "gpt-5.4-mini";

  if (!endpoint || !apiKey || !deployment) {
    throw new Error("Missing AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, or AZURE_OPENAI_DEPLOYMENT_NAME");
  }

  const extractedText = extractPdfTextWithPython(pdfBuffer).slice(0, 300000);
  const url = buildAzureResponsesUrl(endpoint, apiVersion);

  const payload = {
    model: deployment,
    input: [
      { role: "system", content: [{ type: "input_text", text: SYSTEM_PROMPT }] },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              "Extract all data from this iEQ9 report text into this exact JSON schema:",
              SCHEMA,
              "Return only the JSON object.",
              "----- BEGIN REPORT TEXT -----",
              extractedText,
              "----- END REPORT TEXT -----",
            ].join("\n\n"),
          },
        ],
      },
    ],
    max_output_tokens: 5000,
    temperature: 0.1,
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Azure OpenAI parse failed (${response.status}): ${errorBody.slice(0, 500)}`);
  }

  const data = await response.json();
  const text = extractTextFromResponsesPayload(data);
  const jsonText = extractFirstJsonObject(text);

  if (!jsonText) {
    throw new Error("Azure OpenAI response did not contain a JSON object");
  }

  return normalizeParsedShape(safeJsonParse(jsonText));
}

export async function parsePdf(pdfBuffer) {
  return parseViaAzureOpenAI(pdfBuffer);
}
