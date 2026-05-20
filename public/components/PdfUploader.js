// public/components/PdfUploader.js
// Vanilla JS drag-and-drop PDF uploader for the iEQ9 dashboard.
// Usage: mount into any container element via PdfUploader.mount('#upload-container')

const PdfUploader = (() => {
  const API_BASE = window.API_BASE || "/api";

  function mount(selector, onParsed) {
    const container = document.querySelector(selector);
    if (!container) return console.error(`PdfUploader: selector "${selector}" not found`);

    container.innerHTML = `
      <div class="pdf-uploader">
        <div class="uploader-field">
          <label class="uploader-label">CLIENT ID (optional)</label>
          <input class="uploader-input" id="pu-client-id" type="text"
                 placeholder="e.g. ben-russell-2025" />
        </div>

        <div class="uploader-zone" id="pu-zone" tabindex="0" role="button"
             aria-label="Drop iEQ9 PDF here or click to browse">
          <input type="file" id="pu-file" accept="application/pdf"
                 style="display:none" aria-hidden="true" />
          <div class="uploader-idle" id="pu-idle">
            <span class="uploader-icon">📄</span>
            <p class="uploader-text">Drop iEQ9 PDF here, or <u>click to browse</u></p>
            <p class="uploader-sub">Max 25 MB · PDF only</p>
          </div>
          <div class="uploader-loading" id="pu-loading" style="display:none">
            <div class="uploader-spinner" aria-label="Parsing…"></div>
            <p class="uploader-text">gpt-5.4-mini is reading the report…</p>
            <p class="uploader-sub">~20–40 seconds for a full iEQ9 PDF</p>
          </div>
        </div>

        <div class="uploader-error" id="pu-error" role="alert" style="display:none"></div>
        <div class="uploader-result" id="pu-result" style="display:none"></div>
      </div>
    `;

    injectStyles();
    bindEvents(container, onParsed);
  }

  function bindEvents(container, onParsed) {
    const zone = container.querySelector("#pu-zone");
    const fileInput = container.querySelector("#pu-file");

    zone.addEventListener("click", () => fileInput.click());
    zone.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") fileInput.click();
    });
    fileInput.addEventListener("change", (e) => upload(e.target.files[0], container, onParsed));

    zone.addEventListener("dragover", (e) => {
      e.preventDefault();
      zone.classList.add("is-dragging");
    });
    zone.addEventListener("dragleave", () => zone.classList.remove("is-dragging"));
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      zone.classList.remove("is-dragging");
      upload(e.dataTransfer.files[0], container, onParsed);
    });
  }

  async function upload(file, container, onParsed) {
    if (!file || file.type !== "application/pdf") {
      return showError(container, "Please upload a PDF file.");
    }

    setLoading(container, true);
    showError(container, "");

    const fd = new FormData();
    fd.append("report", file);
    const clientId = container.querySelector("#pu-client-id").value.trim();
    if (clientId) fd.append("clientId", clientId);

    try {
      const res = await fetch(`${API_BASE}/pdf/parse`, { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Parsing failed");
      showResult(container, json.data);
      onParsed && onParsed(json.data);
    } catch (err) {
      showError(container, err.message);
    } finally {
      setLoading(container, false);
    }
  }

  function setLoading(c, on) {
    c.querySelector("#pu-idle").style.display = on ? "none" : "";
    c.querySelector("#pu-loading").style.display = on ? "flex" : "none";
    c.querySelector("#pu-zone").style.pointerEvents = on ? "none" : "";
  }

  function showError(c, msg) {
    const el = c.querySelector("#pu-error");
    el.style.display = msg ? "" : "none";
    el.textContent = msg;
  }

  function showResult(c, data) {
    const el = c.querySelector("#pu-result");
    el.style.display = "";
    const scores = data.typeScores || {};
    const bars = Object.entries(scores)
      .map(([key, val]) => {
        const n = parseInt(key.replace("type", ""));
        const isPrimary = n === data.primaryType;
        return `
        <div class="pr-score-row">
          <span class="pr-score-n ${isPrimary ? "is-primary" : ""}">${n}</span>
          <div class="pr-track">
            <div class="pr-bar ${isPrimary ? "is-primary" : ""}"
                 style="width:${val ?? 0}%"></div>
          </div>
          <span class="pr-val">${val ?? "—"}</span>
        </div>`;
      })
      .join("");

    el.innerHTML = `
      <div class="parse-result">
        <div class="pr-header">
          <div>
            <p class="pr-name">${data.clientName || "Unknown Client"}</p>
            <p class="pr-type">Type ${data.primaryType}w${data.wing}
              · ${(data.instinctualVariant || "").toUpperCase()}
              · Level ${data.levelOfDevelopment}
            </p>
          </div>
          <span class="pr-badge">✓ Parsed</span>
        </div>
        <div class="pr-scores">
          <p class="pr-section-label">TYPE SCORES</p>
          ${bars}
        </div>
        ${
          data.reportSummary
            ? `
        <div class="pr-summary">
          <p class="pr-section-label">SUMMARY</p>
          <p class="pr-summary-text">${data.reportSummary}</p>
        </div>`
            : ""
        }
        <details class="pr-json-toggle">
          <summary>View raw JSON</summary>
          <pre class="pr-json">${JSON.stringify(data, null, 2)}</pre>
        </details>
      </div>`;
  }

  function injectStyles() {
    if (document.getElementById("pu-styles")) return;
    const s = document.createElement("style");
    s.id = "pu-styles";
    s.textContent = `
      .pdf-uploader { font-family: 'Jost', sans-serif; max-width: 600px; color: #2a1f1a; }
      .uploader-field { margin-bottom: .75rem; }
      .uploader-label { display: block; font-size: .65rem; letter-spacing: .1em;
                        text-transform: uppercase; color: #6b4f3a; margin-bottom: .3rem; }
      .uploader-input { width: 100%; padding: .45rem .7rem; border: 1px solid #d4b89a;
                        border-radius: 4px; font-family: inherit; font-size: .9rem;
                        box-sizing: border-box; background: #fdf8f3; }
      .uploader-zone  { border: 2px dashed #c9a87c; border-radius: 8px; padding: 2.5rem 1.5rem;
                        text-align: center; cursor: pointer; background: #fdf8f3;
                        transition: border-color .15s, background .15s; outline: none; }
      .uploader-zone:focus, .uploader-zone.is-dragging
                      { border-color: #8B1A1A; background: #fdf0ec; }
      .uploader-icon  { font-size: 2.2rem; }
      .uploader-text  { margin: .4rem 0 .2rem; font-weight: 500; font-size: .95rem; }
      .uploader-sub   { margin: 0; font-size: .78rem; color: #9b7b5a; }
      .uploader-loading { display: flex; flex-direction: column; align-items: center; gap: .6rem; }
      .uploader-spinner { width: 30px; height: 30px; border: 3px solid #d4b89a;
                          border-top-color: #8B1A1A; border-radius: 50%;
                          animation: pu-spin .9s linear infinite; }
      @keyframes pu-spin { to { transform: rotate(360deg); } }
      .uploader-error { margin-top: .75rem; padding: .65rem 1rem; background: #fdf0ec;
                        border: 1px solid #e8a090; border-radius: 6px;
                        color: #7a1a0a; font-size: .88rem; }
      .uploader-result { margin-top: 1rem; }
      .parse-result   { border: 1px solid #d4b89a; border-radius: 8px; overflow: hidden;
                        background: #fdf8f3; }
      .pr-header      { display: flex; justify-content: space-between; align-items: flex-start;
                        padding: .9rem 1.1rem; background: #8B1A1A; color: #fdf8f3; }
      .pr-name        { font-family: 'Cormorant Garamond', serif; font-size: 1.2rem;
                        font-weight: 600; margin: 0 0 .15rem; }
      .pr-type        { font-size: .82rem; font-weight: 500; opacity: .85; margin: 0; }
      .pr-badge       { background: rgba(255,255,255,.18); padding: .2rem .7rem;
                        border-radius: 20px; font-size: .75rem; font-weight: 600; }
      .pr-scores, .pr-summary { padding: .75rem 1.1rem; }
      .pr-section-label { font-size: .6rem; letter-spacing: .12em; text-transform: uppercase;
                          color: #9b7b5a; margin: 0 0 .4rem; }
      .pr-score-row   { display: flex; align-items: center; gap: .4rem; margin-bottom: .25rem; }
      .pr-score-n     { width: 14px; text-align: right; font-size: .82rem; }
      .pr-score-n.is-primary { font-weight: 700; color: #8B1A1A; }
      .pr-track       { flex: 1; height: 7px; background: #e8d9c9; border-radius: 4px; overflow: hidden; }
      .pr-bar         { height: 100%; background: #c9a87c; border-radius: 4px; transition: width .4s; }
      .pr-bar.is-primary { background: #8B1A1A; }
      .pr-val         { width: 26px; font-size: .72rem; color: #6b4f3a; text-align: right; }
      .pr-summary     { border-top: 1px solid #e8d9c9; }
      .pr-summary-text { font-size: .88rem; line-height: 1.6; color: #3a2a1f; margin: 0; }
      .pr-json-toggle { border-top: 1px solid #e8d9c9; }
      .pr-json-toggle summary { padding: .55rem 1.1rem; cursor: pointer;
                                font-size: .75rem; color: #6b4f3a; }
      .pr-json        { margin: 0; padding: .75rem 1.1rem; background: #f5ede3;
                        font-size: .68rem; overflow-x: auto; max-height: 260px;
                        line-height: 1.5; white-space: pre; }
    `;
    document.head.appendChild(s);
  }

  return { mount };
})();

window.PdfUploader = PdfUploader;
