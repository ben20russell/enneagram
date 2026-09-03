// Helper to normalize Azure OpenAI endpoints provided by the portal.
// The portal sometimes shows a full path like
//   https://resource.services.ai.azure.com/openai/v1/responses
// while the app expects the resource root (e.g. https://resource.services.ai.azure.com)
// This function returns the root by stripping any /openai... suffix while keeping
// the scheme and host intact.

export function normalizeAzureOpenAiEndpoint(endpoint) {
  if (!endpoint || typeof endpoint !== 'string') return endpoint;
  // Trim whitespace and trailing slashes
  let e = endpoint.trim();
  // If it contains '/openai' (case-insensitive), strip from that segment onward
  const idx = e.toLowerCase().indexOf('/openai');
  if (idx !== -1) {
    e = e.slice(0, idx);
  }
  // Remove trailing slashes
  e = e.replace(/\/\/+$/,'');
  return e;
}
