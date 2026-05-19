function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function classifyError(error) {
  if (!error) return 'unknown';
  if (typeof error.status === 'number') return `http_${error.status}`;
  const message = String(error.message || error).toLowerCase();
  if (message.includes('aborted') || message.includes('timeout')) return 'timeout';
  if (message.includes('stream disconnected before completion')) return 'stream_disconnected';
  if (message.includes('failed to fetch') || message.includes('network')) return 'network';
  return 'unknown';
}

function isTransientError(error) {
  const status = Number(error && error.status);
  if ([408, 409, 429].includes(status)) return true;
  if (status >= 500 && status < 600) return true;
  const message = String(error && error.message ? error.message : error).toLowerCase();
  return (
    message.includes('stream disconnected before completion') ||
    message.includes('failed to fetch') ||
    message.includes('network') ||
    message.includes('timeout') ||
    message.includes('aborted')
  );
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function buildAzureResponsesUrl(endpoint, apiVersion) {
  const base = endpoint.replace(/\/+$/, '');
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

function extractTextFromResponsesPayload(payload) {
  if (payload && typeof payload.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text;
  }

  const output = Array.isArray(payload && payload.output) ? payload.output : [];
  const parts = [];
  output.forEach(item => {
    if (!item || !Array.isArray(item.content)) return;
    item.content.forEach(part => {
      if (part && typeof part.text === 'string') parts.push(part.text);
    });
  });
  return parts.join('\n').trim();
}

function extractFirstJsonObject(text) {
  if (!text) return null;
  const fenceMatch = text.match(/```json\s*([\s\S]*?)```/i);
  const candidate = fenceMatch ? fenceMatch[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function callAzureFocusRank({ promptText, candidates, config }) {
  const url = buildAzureResponsesUrl(config.endpoint, config.apiVersion);
  const attempts = 5;
  const backoffMs = [500, 1000, 2000, 4000, 8000];

  const systemPrompt = [
    'You rank report modules for relevance to a user prompt.',
    'Return only valid JSON.',
    'Do not include markdown or prose.'
  ].join(' ');

  const userPrompt = JSON.stringify({
    task: 'Select and rank the 6 most relevant report modules for this user prompt.',
    user_prompt: promptText,
    candidate_modules: candidates,
    output_schema: {
      ranked_ids: ['module-id-1', 'module-id-2'],
      rationales: { 'module-id-1': 'short reason (max 18 words)' }
    },
    rules: [
      'Only use candidate ids provided.',
      'Rank by practical usefulness and contextual fit.',
      'Provide concise rationale per ranked id.'
    ]
  });

  const payload = {
    model: config.deployment,
    input: [
      { role: 'system', content: [{ type: 'input_text', text: systemPrompt }] },
      { role: 'user', content: [{ type: 'input_text', text: userPrompt }] }
    ],
    max_output_tokens: 500,
    temperature: 0.2
  };

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'api-key': config.apiKey
          },
          body: JSON.stringify(payload)
        },
        5 * 60 * 1000
      );

      if (!response.ok) {
        const errorBody = await response.text();
        const error = new Error(`Azure Focus API error ${response.status}: ${errorBody.slice(0, 240)}`);
        error.status = response.status;
        throw error;
      }

      const data = await response.json();
      const text = extractTextFromResponsesPayload(data);
      const jsonText = extractFirstJsonObject(text);
      if (!jsonText) throw new Error('AI response did not contain JSON payload.');

      const parsed = JSON.parse(jsonText);
      return {
        rankedIds: Array.isArray(parsed.ranked_ids) ? parsed.ranked_ids : [],
        rationales: parsed.rationales && typeof parsed.rationales === 'object' ? parsed.rationales : {}
      };
    } catch (error) {
      const errorClass = classifyError(error);
      const transient = isTransientError(error);
      const delay = backoffMs[Math.min(attempt - 1, backoffMs.length - 1)];
      const jitterFactor = 1 + ((Math.random() * 0.4) - 0.2);
      const jitteredDelay = Math.max(50, Math.round(delay * jitterFactor));

      console.log('[focus][api] retry decision', {
        attempt,
        maxAttempts: attempts,
        transient,
        errorClass,
        delayMs: transient && attempt < attempts ? jitteredDelay : 0
      });

      if (!transient || attempt >= attempts) throw error;
      await sleep(jitteredDelay);
    }
  }

  return { rankedIds: [], rationales: {} };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { error: 'method_not_allowed' });
  }

  const endpoint = process.env.AZURE_OPENAI_ENDPOINT || '';
  const apiKey = process.env.AZURE_OPENAI_API_KEY || '';
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2025-04-01-preview';
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT_NAME || 'gpt-5.4-mini';

  if (!endpoint || !apiKey || !deployment) {
    return json(res, 500, { error: 'focus_ai_not_configured' });
  }

  let body = {};
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  } catch (error) {
    return json(res, 400, { error: 'invalid_json_body' });
  }
  const promptText = typeof body.promptText === 'string' ? body.promptText.slice(0, 4000) : '';
  const candidates = Array.isArray(body.candidates) ? body.candidates.slice(0, 12) : [];

  if (!promptText.trim()) return json(res, 400, { error: 'missing_prompt' });
  if (!candidates.length) return json(res, 400, { error: 'missing_candidates' });

  try {
    const result = await callAzureFocusRank({
      promptText,
      candidates,
      config: { endpoint, apiKey, apiVersion, deployment }
    });
    return json(res, 200, result);
  } catch (error) {
    const errorClass = classifyError(error);
    console.log('[focus][api] failed', { errorClass, message: String(error && error.message ? error.message : error) });
    return json(res, 502, { error: 'focus_ai_failed', errorClass });
  }
}
