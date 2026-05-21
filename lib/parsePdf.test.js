import test from 'node:test';
import assert from 'node:assert/strict';

process.env.AZURE_OPENAI_ENDPOINT = 'https://example.openai.azure.com';
process.env.AZURE_OPENAI_API_KEY = 'test-key';
process.env.AZURE_OPENAI_API_VERSION = '2024-02-15-preview';
process.env.AZURE_OPENAI_DEPLOYMENT_NAME = 'gpt-4o';

const { parsePdf, buildAzureResponsesUrl } = await import('../lib/parsePdf.js');

test('buildAzureResponsesUrl builds chat completions url from bare endpoint', () => {
  assert.equal(
    buildAzureResponsesUrl('https://example.openai.azure.com/', '2024-02-15-preview'),
    'https://example.openai.azure.com/openai/chat/completions?api-version=2024-02-15-preview',
  );
});

test('parsePdf posts base64 PDF as image_url payload and parses JSON string content', async () => {
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      async json() {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  clientName: 'Ben Russell',
                  primaryType: 8,
                  typeScores: {
                    type1: 11,
                    type2: 22,
                    type3: 33,
                    type4: 44,
                    type5: 55,
                    type6: 66,
                    type7: 77,
                    type8: 88,
                    type9: 99,
                  },
                }),
              },
            },
          ],
        };
      },
    };
  };

  const result = await parsePdf(Buffer.from('fake-pdf-content'));
  assert.equal(result.clientName, 'Ben Russell');
  assert.equal(result.primaryType, 8);
  assert.equal(result.typeScores.type8, 88);

  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, 'gpt-4o');
  assert.equal(body.messages[1].content[1].type, 'image_url');
  assert.match(body.messages[1].content[1].image_url.url, /^data:application\/pdf;base64,/);
  assert.equal(body.response_format.type, 'json_schema');
});

test('parsePdf surfaces Azure error payload details', async () => {
  global.fetch = async () => ({
    ok: false,
    status: 400,
    async text() {
      return 'bad request details';
    },
  });

  await assert.rejects(
    () => parsePdf(Buffer.from('fake')),
    /Azure OpenAI parse failed \(400\): bad request details/,
  );
});
