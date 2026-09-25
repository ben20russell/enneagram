import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(new URL("../scripts/test-azure-openai.mjs", import.meta.url));
const apiKey = "test-only-secret-do-not-log";

async function runDiagnostic(t, { status = 200, response, args = [], endpointSuffix = "", envFile, underTestRunner = false } = {}) {
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const request = { url: req.url, headers: req.headers, body: JSON.parse(body) };
    requests.push(request);
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(typeof response === "function" ? response(request) : response));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const directory = await mkdtemp(path.join(tmpdir(), "azure-diagnostic-test-"));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  if (envFile) await writeFile(path.join(directory, ".env.local"), envFile);
  const endpoint = `http://127.0.0.1:${server.address().port}${endpointSuffix}`;
  const childEnvironment = { ...process.env };
  // These subprocesses represent an explicit CLI invocation unless testing discovery itself.
  delete childEnvironment.NODE_TEST_CONTEXT;
  const result = await new Promise((resolve) => {
    execFile(process.execPath, underTestRunner ? ["--test", scriptPath] : [scriptPath, ...args], {
      cwd: directory,
      env: {
        ...childEnvironment,
        AZURE_OPENAI_ENDPOINT: endpoint,
        AZURE_OPENAI_API_KEY: apiKey,
        AZURE_OPENAI_DEPLOYMENT_NAME: "deployment-alias",
        AZURE_OPENAI_API_VERSION: "2025-04-01-preview",
      },
      timeout: 10_000,
    }, (error, stdout, stderr) => resolve({ code: error?.code ?? 0, output: stdout + stderr }));
  });
  assert.doesNotMatch(result.output, new RegExp(apiKey), "The diagnostic must not log its API key.");
  return { ...result, requests };
}

function completedResponse(overrides = {}) {
  return {
    model: "gpt-6-astra-2026-09-01",
    status: "completed",
    output: [{ type: "message", content: [{ type: "output_text", text: '{"greeting":"Hello"}' }] }],
    ...overrides,
  };
}

test("Azure diagnostic exits nonzero on HTTP 404 and explains resource-scoped deployments", async (t) => {
  const result = await runDiagnostic(t, {
    status: 404,
    response: { error: { code: "DeploymentNotFound", message: "The API deployment for this resource does not exist." } },
  });
  assert.equal(result.code, 1);
  assert.match(result.output, /HTTP 404/);
  assert.match(result.output, /DeploymentNotFound/);
  assert.match(result.output, /deployment.*exist.*resource/i);
  assert.match(result.output, /model catalog/i);
});

test("Node test discovery skips the live Azure diagnostic without making network requests", async (t) => {
  const result = await runDiagnostic(t, {
    underTestRunner: true,
    status: 500,
    response: { error: { message: "Gateway cannot authenticate upstream services" } },
  });
  assert.equal(result.code, 0);
  assert.equal(result.requests.length, 0, "The project test suite must not call paid Azure endpoints.");
  assert.match(result.output, /skip/i);
  assert.match(result.output, /node scripts\/test-azure-openai\.mjs/);
});

test("Azure diagnostic rejects an error payload even with HTTP 200 and redacts secrets", async (t) => {
  const result = await runDiagnostic(t, {
    response: { error: { code: "Unauthorized", message: `Rejected api-key ${apiKey}` } },
  });
  assert.equal(result.code, 1);
  assert.match(result.output, /Unauthorized/);
});

test("Azure diagnostic rejects incomplete Responses output even when it includes text", async (t) => {
  const result = await runDiagnostic(t, {
    response: completedResponse({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }),
  });
  assert.equal(result.code, 1);
  assert.match(result.output, /incomplete.*max_output_tokens/i);
});

test("Azure diagnostic rejects empty Responses output", async (t) => {
  const result = await runDiagnostic(t, { response: completedResponse({ output: [] }) });
  assert.equal(result.code, 1);
  assert.match(result.output, /empty|no.*text/i);
});

test("Azure diagnostic requires a returned model before claiming success", async (t) => {
  const result = await runDiagnostic(t, { response: completedResponse({ model: "" }) });
  assert.equal(result.code, 1);
  assert.match(result.output, /model/i);
});

test("Azure diagnostic validates Responses content and reports the returned model separately from the deployment", async (t) => {
  const result = await runDiagnostic(t, { response: completedResponse() });
  assert.equal(result.code, 0);
  assert.match(result.output, /PASS.*Responses/);
  assert.match(result.output, /Returned model: gpt-6-astra-2026-09-01/);
  assert.match(result.output, /Hello/);
  assert.equal(result.requests[0].body.model, "deployment-alias");
  assert.equal(result.requests[0].headers["api-key"], apiKey);
  assert.equal(result.requests[0].url, "/openai/responses?api-version=2025-04-01-preview");
});

test("Azure diagnostic normalizes the v1 base URL without adding a preview query", async (t) => {
  const result = await runDiagnostic(t, { response: completedResponse(), endpointSuffix: "/openai/v1/" });
  assert.equal(result.code, 0);
  assert.equal(result.requests[0].url, "/openai/v1/responses");
});

test("Azure PDF diagnostic uses the parser route and strict structured outputs", async (t) => {
  const result = await runDiagnostic(t, {
    args: ["--pdf"],
    endpointSuffix: "/openai/v1/responses",
    response: {
      model: "gpt-6-astra-2026-09-01",
      choices: [{ finish_reason: "stop", message: { content: '{"greeting":"Hello"}' } }],
    },
  });
  assert.equal(result.code, 0);
  assert.match(result.output, /PASS.*PDF/);
  assert.equal(result.requests[0].url, "/openai/deployments/deployment-alias/chat/completions?api-version=2025-04-01-preview");
  assert.equal(result.requests[0].body.response_format.type, "json_schema");
  assert.equal(result.requests[0].body.response_format.json_schema.strict, true);
});

test("Azure PDF diagnostic rejects truncated or invalid structured output", async (t) => {
  for (const choice of [
    { finish_reason: "length", message: { content: '{"greeting":"Hello"}' } },
    { finish_reason: "stop", message: { content: '{"unexpected":"Hello"}' } },
  ]) {
    const result = await runDiagnostic(t, {
      args: ["--pdf"],
      response: { model: "gpt-6-astra-2026-09-01", choices: [choice] },
    });
    assert.equal(result.code, 1);
    assert.match(result.output, /length|schema/i);
  }
});

test("Azure diagnostic --both checks Responses and the PDF route", async (t) => {
  const result = await runDiagnostic(t, {
    args: ["--both"],
    response: (request) => request.url.includes("chat/completions")
      ? { model: "gpt-6-astra-2026-09-01", choices: [{ finish_reason: "stop", message: { content: '{"greeting":"Hello"}' } }] }
      : completedResponse(),
  });
  assert.equal(result.code, 0);
  assert.equal(result.requests.length, 2);
  assert.match(result.output, /PASS.*Responses/);
  assert.match(result.output, /PASS.*PDF/);
});

test("Azure diagnostic preserves environment deployment overrides when loading .env.local", async (t) => {
  const result = await runDiagnostic(t, {
    response: completedResponse(),
    envFile: "AZURE_OPENAI_DEPLOYMENT_NAME=stale-file-deployment\n",
  });
  assert.equal(result.code, 0);
  assert.equal(result.requests[0].body.model, "deployment-alias");
});
