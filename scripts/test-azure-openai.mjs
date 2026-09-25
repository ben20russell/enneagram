import fs from 'fs/promises';
import { normalizeAzureOpenAiEndpoint } from '../lib/normalizeAzureOpenAiEndpoint.js';

// Prefer native fetch if available, otherwise dynamically import node-fetch
let fetchFn;
if (typeof globalThis.fetch === 'function') {
  fetchFn = globalThis.fetch.bind(globalThis);
} else {
  const nf = await import('node-fetch');
  fetchFn = nf.default || nf;
}

// Try to load dotenv if present; otherwise parse .env.local manually
try {
  const dotenv = await import('dotenv');
  dotenv.config({ path: '.env.local' });
} catch (e) {
  try {
    const text = await fs.readFile('.env.local', 'utf8');
    text.split(/\r?\n/).forEach(line => {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) return;
      let [, key, val] = m;
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      // Match dotenv: explicitly supplied environment variables take precedence.
      if (process.env[key] === undefined) process.env[key] = val;
    });
  } catch (err) {
    // ignore; missing env file will be reported later
  }
}

const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
const apiKey = process.env.AZURE_OPENAI_API_KEY;
const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2025-04-01-preview';
const deployment = process.env.AZURE_OPENAI_DEPLOYMENT_NAME;

function redact(value) {
  const text = String(value);
  return apiKey ? text.split(apiKey).join('[REDACTED]') : text;
}

function buildAzureUrl(mode) {
  const configured = new URL(endpoint.trim());
  const root = new URL(normalizeAzureOpenAiEndpoint(endpoint));
  root.search = '';
  root.hash = '';
  const base = root.toString().replace(/\/+$/, '');
  if (mode === 'pdf') {
    // Use the same resource normalization and route as lib/parsePdf.js.
    return `${base}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;
  }
  if (/\/openai\/v1(?:\/|$)/i.test(configured.pathname)) {
    return `${base}/openai/v1/responses`;
  }
  const version = configured.searchParams.get('api-version') || apiVersion;
  return `${base}/openai/responses?api-version=${encodeURIComponent(version)}`;
}

function buildPayload(mode) {
  const systemPrompt = 'You are a helpful assistant.';
  const userPrompt = 'Say hello and return a short JSON: {"greeting": "..."}';
  if (mode === 'pdf') {
    return {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'azure_pdf_diagnostic',
          strict: true,
          schema: {
            type: 'object',
            properties: { greeting: { type: 'string' } },
            required: ['greeting'],
            additionalProperties: false,
          },
        },
      },
      max_completion_tokens: 1024,
    };
  }
  return {
    model: deployment,
    input: [
      { role: 'system', content: [{ type: 'input_text', text: systemPrompt }] },
      { role: 'user', content: [{ type: 'input_text', text: userPrompt }] },
    ],
    max_output_tokens: 1024,
  };
}

function validateOutput(data, mode) {
  if (typeof data?.model !== 'string' || !data.model.trim()) {
    throw new Error('The response did not identify the returned model.');
  }
  if (mode === 'pdf') {
    const choice = data.choices?.[0];
    if (choice?.finish_reason !== 'stop') {
      throw new Error(`PDF response did not finish successfully (${choice?.finish_reason || 'missing finish_reason'}).`);
    }
    let result;
    try {
      result = JSON.parse(choice.message?.content);
    } catch {
      throw new Error('PDF response is not valid JSON for the requested schema.');
    }
    if (!result || typeof result.greeting !== 'string' || !result.greeting.trim() || Object.keys(result).length !== 1) {
      throw new Error('PDF response does not match the requested greeting schema.');
    }
    return JSON.stringify(result);
  }
  if (data.status !== 'completed') {
    throw new Error(`Responses output is ${data.status || 'missing status'} (${data.incomplete_details?.reason || 'not completed'}).`);
  }
  const text = typeof data.output_text === 'string' && data.output_text.trim()
    ? data.output_text
    : (Array.isArray(data.output) ? data.output : [])
      .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
      .filter((part) => part?.type === 'output_text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('\n');
  if (!text.trim()) throw new Error('Responses completed with empty output: no generated text was returned.');
  return text;
}

async function probe(mode) {
  const label = mode === 'pdf' ? 'PDF Chat Completions + strict JSON' : 'Responses';
  const url = buildAzureUrl(mode);
  const logUrl = new URL(url);
  logUrl.username = '';
  logUrl.password = '';
  console.log(redact(`[${label}] Using endpoint: ${logUrl}`));
  console.log(redact(`[${label}] Using deployment: ${deployment}`));

  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey
      },
      body: JSON.stringify(buildPayload(mode)),
      signal: AbortSignal.timeout(5 * 60 * 1000),
    });

    console.log(`[${label}] HTTP ${res.status}`);
    const data = await res.json().catch(() => null);
    if (!res.ok || data?.error) {
      const error = data?.error;
      const detail = typeof error === 'string' ? error : [error?.code, error?.message].filter(Boolean).join(': ');
      const hint = res.status === 404 || error?.code === 'DeploymentNotFound'
        ? ' Confirm AZURE_OPENAI_DEPLOYMENT_NAME exists as a deployment in the resource addressed by AZURE_OPENAI_ENDPOINT; a model catalog entry is not a deployment. Also verify the API route/version.'
        : '';
      throw new Error(`HTTP ${res.status}${detail ? `: ${detail}` : ': Azure request failed.'}${hint}`);
    }
    const text = validateOutput(data, mode);
    console.log(`PASS ${label}`);
    console.log(redact(`Returned model: ${data.model}`));
    console.log(redact(`Output text: ${text.slice(0, 512)}`));
    return true;
  } catch (err) {
    console.error(redact(`FAIL ${label}: ${err.message}`));
    return false;
  }
}

async function run() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: node scripts/test-azure-openai.mjs [--pdf | --both]');
    console.log('Default: Responses. --pdf: parser Chat Completions route with strict JSON. --both: check both.');
    return 0;
  }
  if (args.length > 1 || args.some((arg) => !['--pdf', '--both'].includes(arg))) {
    console.error('Unknown arguments. Use --help, --pdf, or --both.');
    return 2;
  }
  if (!endpoint || !apiKey || !deployment) {
    console.error('Missing AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY or AZURE_OPENAI_DEPLOYMENT_NAME in the environment or .env.local');
    return 2;
  }
  let passed = true;
  for (const mode of args.includes('--both') ? ['responses', 'pdf'] : [args.includes('--pdf') ? 'pdf' : 'responses']) {
    if (!await probe(mode)) passed = false;
  }
  return passed ? 0 : 1;
}

if (process.env.NODE_TEST_CONTEXT) {
  // Node discovers this CLI by its test-* filename. Keep npm test offline;
  // the process-level regression tests exercise explicit CLI calls with mocked Azure responses.
  const { test } = await import('node:test');
  test('Live Azure diagnostic', {
    skip: 'Run explicitly with node scripts/test-azure-openai.mjs --both',
  }, () => {});
} else {
  try {
    process.exitCode = await run();
  } catch (err) {
    console.error(redact(`Test configuration failed: ${err.message}`));
    process.exitCode = 2;
  }
}
