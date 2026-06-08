import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { execFileSync } from "node:child_process";

const repoRoot = path.resolve(process.cwd());
const extractReportScriptPath = path.join(repoRoot, "scripts", "extract_report_pdf.py");

function runMetadataExtraction(text) {
  const output = execFileSync(
    "python3",
    [
      "-c",
      `
import importlib.util
import json
import os

script_path = os.environ["SCRIPT_PATH"]
input_text = os.environ.get("INPUT_TEXT", "")

spec = importlib.util.spec_from_file_location("extract_report_pdf", script_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

normalized = module.normalize(input_text)
detected_type, detected_type_source = module.extract_type(normalized)
client_name = module.extract_first(
    normalized,
    [
        r"\\bClient\\s*Name\\s*[:\\-]?\\s*([^:]{2,80}?)(?=\\s*(?:Report\\s*Date|ReportDate|Date\\s*of\\s*Report|DateofReport|Main\\s*Type|MainType|Trifix|Level\\s*of\\s*Development|LevelofDevelopment|Wing|Center\\s*of\\s*Intelligence|CenterofIntelligence|Centre\\s*of\\s*Intelligence|CentreofIntelligence|$))",
        r"\\bName\\s*[:\\-]?\\s*([^:]{2,80}?)(?=\\s*(?:Report\\s*Date|ReportDate|Main\\s*Type|MainType|Trifix|Level\\s*of\\s*Development|LevelofDevelopment|Wing|Center\\s*of\\s*Intelligence|CenterofIntelligence|Centre\\s*of\\s*Intelligence|CentreofIntelligence|$))",
    ],
)
report_date = module.extract_first(
    normalized,
    [
        r"\\bReport\\s*Date\\s*[:\\-]?\\s*([^:]{3,60}?)(?=\\s*(?:Client\\s*Name|ClientName|Main\\s*Type|MainType|Trifix|Level\\s*of\\s*Development|LevelofDevelopment|Wing|Center\\s*of\\s*Intelligence|CenterofIntelligence|Centre\\s*of\\s*Intelligence|CentreofIntelligence|$))",
        r"\\bDate\\s*of\\s*Report\\s*[:\\-]?\\s*([^:]{3,60}?)(?=\\s*(?:Client\\s*Name|ClientName|Main\\s*Type|MainType|Trifix|Level\\s*of\\s*Development|LevelofDevelopment|Wing|Center\\s*of\\s*Intelligence|CenterofIntelligence|Centre\\s*of\\s*Intelligence|CentreofIntelligence|$))",
    ],
)
trifix = module.normalize_trifix(
    module.extract_first(
        normalized,
        [
            r"\\bTrifix\\s*[:\\-]?\\s*([^:]{2,40}?)(?=\\s*(?:Level\\s*of\\s*Development|LevelofDevelopment|Wing|Center\\s*of\\s*Intelligence|CenterofIntelligence|Centre\\s*of\\s*Intelligence|CentreofIntelligence|$))",
        ],
    )
)
level_of_development = module.extract_first(
    normalized,
    [
        r"\\bLevel\\s*of\\s*Development\\s*[:\\-]?\\s*([^:]{2,50}?)(?=\\s*(?:Center\\s*of\\s*Intelligence|CenterofIntelligence|Centre\\s*of\\s*Intelligence|CentreofIntelligence|Wing|Trifix|$))",
    ],
)
centre_of_intelligence = module.extract_first(
    normalized,
    [
        r"\\b(?:Centre|Center)\\s*of\\s*Intelligence\\s*[:\\-]?\\s*([^:]{2,50}?)(?=\\s*(?:Level\\s*of\\s*Development|LevelofDevelopment|Wing|Trifix|$))",
    ],
)
print(json.dumps({
    "detectedType": detected_type,
    "detectedTypeSource": detected_type_source,
    "clientName": client_name,
    "reportDate": report_date,
    "trifix": trifix,
    "levelOfDevelopment": level_of_development,
    "centreOfIntelligence": centre_of_intelligence,
}))
      `.trim(),
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        SCRIPT_PATH: extractReportScriptPath,
        INPUT_TEXT: text,
      },
    },
  );

  return JSON.parse(String(output || "{}"));
}

test("extract_report_pdf resolves letter-spaced OCR metadata blocks", () => {
  const sampleText = [
    "C l i e n t   N a m e : B e n   R u s s e l l",
    "R e p o r t   D a t e : 0 6 / 0 8 / 2 0 2 6",
    "M a i n   T y p e   # 8",
    "T r i f i x : 8 - 3 - 7",
    "L e v e l   o f   D e v e l o p m e n t : H i g h",
    "C e n t r e   o f   I n t e l l i g e n c e : B o d y",
  ].join("   ");

  const extracted = runMetadataExtraction(sampleText);

  assert.equal(extracted?.detectedType, "8");
  assert.equal(extracted?.clientName, "Ben Russell");
  assert.equal(extracted?.reportDate, "06/08/2026");
  assert.equal(extracted?.trifix, "8-3-7");
  assert.equal(extracted?.levelOfDevelopment, "High");
  assert.equal(extracted?.centreOfIntelligence, "Body");
});
