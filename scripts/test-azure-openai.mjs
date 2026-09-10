import fs from 'fs/promises';

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
      process.env[key] = val;
    });
  } catch (err) {
    // ignore; missing env file will be reported later
  }
}

const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
const apiKey = process.env.AZURE_OPENAI_API_KEY;
const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2024-11-20';
const deployment = process.env.AZURE_OPENAI_DEPLOYMENT_NAME;

function buildAzureResponsesUrl(endpoint, apiVersion) {
  const base = endpoint.replace(/\/+$/, '');
  if (base.includes('/openai/v1/responses')) {
    return base;
  }
  if (base.includes('/openai/responses')) {
    const parsed = new URL(base);
    if (!parsed.searchParams.has('api-version')) {
      parsed.searchParams.set('api-version', apiVersion);
    }
    return parsed.toString();
  }
  if (base.includes('/openai')) {
    return `${base}/responses?api-version=${encodeURIComponent(apiVersion)}`;
  }
  return `${base}/openai/responses?api-version=${encodeURIComponent(apiVersion)}`;
}

async function run() {
  if (!endpoint || !apiKey || !deployment) {
    console.error('Missing AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY or AZURE_OPENAI_DEPLOYMENT_NAME in .env.local');
    process.exit(2);
  }

  const url = buildAzureResponsesUrl(endpoint, apiVersion);
  console.log('Using endpoint:', url);
  console.log('Using deployment:', deployment);

  const systemPrompt = 'You are a helpful assistant.';
  const userPrompt = 'Say hello and return a short JSON: {"greeting": "..."}';

  const payload = {
    model: deployment,
    input: [
      { role: 'system', content: [{ type: 'input_text', text: systemPrompt }] },
      { role: 'user', content: [{ type: 'input_text', text: userPrompt }] }
    ],
    max_output_tokens: 200
  };

  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey
      },
      body: JSON.stringify(payload),
      // 5 minute timeout handled by environment if needed
    });

    console.log('HTTP', res.status);
    const data = await res.json();
    console.log('Raw response:', JSON.stringify(data, null, 2));

    if (data && typeof data.output_text === 'string') {
      console.log('Output text:', data.output_text);
    } else if (Array.isArray(data.output)) {
      const parts = [];
      data.output.forEach(item => {
        if (!item || !Array.isArray(item.content)) return;
        item.content.forEach(part => {
          if (part && typeof part.text === 'string') parts.push(part.text);
        });
      });
      console.log('Extracted text:', parts.join('\n'));
    } else if (data && data.items) {
      console.log('Items:', JSON.stringify(data.items, null, 2));
    }
  } catch (err) {
    console.error('Test call failed:', err);
    process.exit(1);
  }
}

run();
