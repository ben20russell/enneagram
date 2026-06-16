import { PDFArray, PDFDict, PDFDocument, PDFName } from "pdf-lib";

const DEFAULT_FORM_FIELD_MODE = "flatten";
const ALLOWED_FORM_FIELD_MODES = new Set(["flatten", "keep"]);

function normalizeSourceLabel(source) {
  const normalized = String(source || "").trim();
  return normalized || "unknown";
}

export function resolvePdfSanitizeFormFieldMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "remove") {
    // We intentionally avoid removing field values so extracted content is preserved for parsing.
    return "flatten";
  }
  if (ALLOWED_FORM_FIELD_MODES.has(normalized)) {
    return normalized;
  }
  return DEFAULT_FORM_FIELD_MODE;
}

function createBaseDiagnostics({
  source,
  annotationCleanupEnabled,
  formFieldMode,
  stripNonContentExtras,
  stripMetadata,
  inputBytes,
}) {
  return {
    source: normalizeSourceLabel(source),
    annotationCleanupEnabled,
    formFieldMode,
    stripNonContentExtras,
    stripMetadata,
    inputBytes: Number.isFinite(Number(inputBytes)) ? Number(inputBytes) : 0,
    outputBytes: Number.isFinite(Number(inputBytes)) ? Number(inputBytes) : 0,
    pageCount: 0,
    annotationObjectsRemoved: 0,
    pagesWithAnnotationsStripped: 0,
    formFieldCountBefore: 0,
    formFieldCountAfter: 0,
    formFieldsRemoved: 0,
    formFieldsFlattened: 0,
    metadataCleared: false,
    catalogEntriesRemoved: [],
    namesEntriesRemoved: [],
    acroFormEntriesRemoved: [],
    sanitized: false,
    reason: null,
    error: null,
  };
}

function pushUnique(target, value) {
  if (!value) return;
  if (!Array.isArray(target)) return;
  if (target.includes(value)) return;
  target.push(value);
}

function countPdfArrayEntries(value) {
  if (!value) return 0;
  if (typeof value.size === "function") {
    const size = Number(value.size());
    if (Number.isFinite(size) && size > 0) return Math.floor(size);
  }
  if (Array.isArray(value)) {
    return value.length;
  }
  return 1;
}

function removeCatalogEntryIfPresent(pdfDoc, key, diagnostics) {
  const keyName = PDFName.of(key);
  if (pdfDoc.catalog.has(keyName)) {
    pdfDoc.catalog.delete(keyName);
    pushUnique(diagnostics.catalogEntriesRemoved, key);
  }
}

function stripCatalogNamesExtras(pdfDoc, diagnostics) {
  const namesKey = PDFName.of("Names");
  const namesDict = pdfDoc.catalog.lookupMaybe(namesKey, PDFDict);
  if (!(namesDict instanceof PDFDict)) return;

  for (const namesEntry of ["EmbeddedFiles", "JavaScript"]) {
    const entryKey = PDFName.of(namesEntry);
    if (namesDict.has(entryKey)) {
      namesDict.delete(entryKey);
      pushUnique(diagnostics.namesEntriesRemoved, namesEntry);
    }
  }

  const remainingNamesEntries = Array.isArray(namesDict.keys()) ? namesDict.keys().length : 0;
  if (remainingNamesEntries <= 0) {
    pdfDoc.catalog.delete(namesKey);
    pushUnique(diagnostics.catalogEntriesRemoved, "Names");
  }
}

function stripAcroFormExtras(pdfDoc, diagnostics) {
  const acroFormKey = PDFName.of("AcroForm");
  const acroFormDict = pdfDoc.catalog.lookupMaybe(acroFormKey, PDFDict);
  if (!(acroFormDict instanceof PDFDict)) return;

  for (const acroFormEntry of ["XFA", "CO", "NeedAppearances"]) {
    const entryKey = PDFName.of(acroFormEntry);
    if (acroFormDict.has(entryKey)) {
      acroFormDict.delete(entryKey);
      pushUnique(diagnostics.acroFormEntriesRemoved, acroFormEntry);
    }
  }
}

function clearPdfMetadata(pdfDoc, diagnostics) {
  try {
    pdfDoc.setTitle("");
    pdfDoc.setAuthor("");
    pdfDoc.setSubject("");
    pdfDoc.setCreator("");
    pdfDoc.setProducer("");
    pdfDoc.setKeywords([]);
    pdfDoc.setLanguage("");
    pdfDoc.setCreationDate(new Date(0));
    pdfDoc.setModificationDate(new Date(0));
  } catch (metadataError) {
    console.log("[pdf-sanitize] Failed to clear some high-level metadata fields", {
      details: String(metadataError?.message || metadataError),
    });
  }

  try {
    if (pdfDoc?.context?.trailerInfo && Object.prototype.hasOwnProperty.call(pdfDoc.context.trailerInfo, "Info")) {
      pdfDoc.context.trailerInfo.Info = undefined;
    }
  } catch (trailerError) {
    console.log("[pdf-sanitize] Failed to clear trailer Info metadata", {
      details: String(trailerError?.message || trailerError),
    });
  }

  diagnostics.metadataCleared = true;
}

function calculateSanitizationChanged(diagnostics) {
  return (
    Number(diagnostics?.annotationObjectsRemoved || 0) > 0 ||
    Number(diagnostics?.formFieldsRemoved || 0) > 0 ||
    Number(diagnostics?.formFieldsFlattened || 0) > 0 ||
    (Array.isArray(diagnostics?.catalogEntriesRemoved) && diagnostics.catalogEntriesRemoved.length > 0) ||
    (Array.isArray(diagnostics?.namesEntriesRemoved) && diagnostics.namesEntriesRemoved.length > 0) ||
    (Array.isArray(diagnostics?.acroFormEntriesRemoved) && diagnostics.acroFormEntriesRemoved.length > 0) ||
    Boolean(diagnostics?.metadataCleared)
  );
}

export async function sanitizePdfForParsing(pdfBuffer, options = {}) {
  const normalizedSource = normalizeSourceLabel(options?.source);
  const annotationCleanupEnabled = options?.removeAnnotations !== false;
  const stripNonContentExtras = options?.stripNonContentExtras !== false;
  const stripMetadata = options?.stripMetadata !== false;
  const formFieldMode = resolvePdfSanitizeFormFieldMode(
    options?.formFieldMode ?? process.env.PDF_SANITIZE_FORM_FIELDS_MODE,
  );
  const inputBuffer = Buffer.isBuffer(pdfBuffer) ? pdfBuffer : Buffer.from(pdfBuffer || Buffer.alloc(0));

  const diagnostics = createBaseDiagnostics({
    source: normalizedSource,
    annotationCleanupEnabled,
    formFieldMode,
    stripNonContentExtras,
    stripMetadata,
    inputBytes: inputBuffer.length,
  });

  console.log("[pdf-sanitize] Starting PDF sanitization", {
    source: normalizedSource,
    inputBytes: inputBuffer.length,
    annotationCleanupEnabled,
    formFieldMode,
    stripNonContentExtras,
    stripMetadata,
  });

  if (!Buffer.isBuffer(inputBuffer) || inputBuffer.length <= 0) {
    diagnostics.reason = "invalid_input_buffer";
    diagnostics.sanitized = false;
    console.log("[pdf-sanitize] Skipping sanitization due to invalid input buffer", {
      source: normalizedSource,
      inputBytes: inputBuffer.length,
    });
    return {
      buffer: inputBuffer,
      sanitized: false,
      diagnostics,
    };
  }

  try {
    const pdfDoc = await PDFDocument.load(inputBuffer, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    const pages = pdfDoc.getPages();
    diagnostics.pageCount = Array.isArray(pages) ? pages.length : 0;

    if (annotationCleanupEnabled) {
      const annotsKey = PDFName.of("Annots");
      for (const page of pages) {
        const existingAnnots = page?.node?.lookupMaybe?.(annotsKey, PDFArray);
        if (!existingAnnots) continue;
        const annotationCount = countPdfArrayEntries(existingAnnots);
        diagnostics.annotationObjectsRemoved += annotationCount;
        diagnostics.pagesWithAnnotationsStripped += 1;
        page.node.set(annotsKey, pdfDoc.context.obj([]));
      }
    }

    let form = null;
    try {
      form = pdfDoc.getForm();
    } catch (formError) {
      form = null;
      console.log("[pdf-sanitize] PDF has no acroform fields", {
        source: normalizedSource,
        details: String(formError?.message || formError),
      });
    }

    if (form) {
      const fields = form.getFields();
      diagnostics.formFieldCountBefore = Array.isArray(fields) ? fields.length : 0;

      if (formFieldMode === "flatten" && diagnostics.formFieldCountBefore > 0) {
        form.flatten();
        diagnostics.formFieldsFlattened = diagnostics.formFieldCountBefore;
      }

      diagnostics.formFieldCountAfter = form.getFields().length;
      if (formFieldMode !== "keep" && diagnostics.formFieldCountAfter <= 0) {
        removeCatalogEntryIfPresent(pdfDoc, "AcroForm", diagnostics);
      }
    }

    if (stripNonContentExtras) {
      removeCatalogEntryIfPresent(pdfDoc, "OpenAction", diagnostics);
      removeCatalogEntryIfPresent(pdfDoc, "AA", diagnostics);
      removeCatalogEntryIfPresent(pdfDoc, "AF", diagnostics);
      removeCatalogEntryIfPresent(pdfDoc, "Metadata", diagnostics);
      stripCatalogNamesExtras(pdfDoc, diagnostics);
      stripAcroFormExtras(pdfDoc, diagnostics);
    }

    if (stripMetadata) {
      clearPdfMetadata(pdfDoc, diagnostics);
    }

    const sanitizedBytes = await pdfDoc.save({
      useObjectStreams: false,
      updateFieldAppearances: formFieldMode === "flatten",
    });
    diagnostics.outputBytes = Buffer.byteLength(sanitizedBytes);
    diagnostics.sanitized = calculateSanitizationChanged(diagnostics);

    console.log("[pdf-sanitize] Completed PDF sanitization", {
      source: normalizedSource,
      inputBytes: diagnostics.inputBytes,
      outputBytes: diagnostics.outputBytes,
      pageCount: diagnostics.pageCount,
      annotationObjectsRemoved: diagnostics.annotationObjectsRemoved,
      pagesWithAnnotationsStripped: diagnostics.pagesWithAnnotationsStripped,
      formFieldMode,
      formFieldCountBefore: diagnostics.formFieldCountBefore,
      formFieldCountAfter: diagnostics.formFieldCountAfter,
      formFieldsRemoved: diagnostics.formFieldsRemoved,
      formFieldsFlattened: diagnostics.formFieldsFlattened,
      metadataCleared: diagnostics.metadataCleared,
      catalogEntriesRemoved: diagnostics.catalogEntriesRemoved,
      namesEntriesRemoved: diagnostics.namesEntriesRemoved,
      acroFormEntriesRemoved: diagnostics.acroFormEntriesRemoved,
      sanitized: diagnostics.sanitized,
    });

    return {
      buffer: Buffer.from(sanitizedBytes),
      sanitized: diagnostics.sanitized,
      diagnostics,
    };
  } catch (error) {
    const details = String(error?.message || error);
    diagnostics.reason = "sanitize_failed";
    diagnostics.error = details;
    diagnostics.sanitized = false;
    console.log("[pdf-sanitize] Sanitization failed; falling back to original buffer", {
      source: normalizedSource,
      details,
    });
    return {
      buffer: inputBuffer,
      sanitized: false,
      diagnostics,
    };
  }
}

export async function sanitizePdfForParsingBuffer(pdfBuffer, options = {}) {
  const result = await sanitizePdfForParsing(pdfBuffer, options);
  if (Buffer.isBuffer(result?.buffer)) {
    return result.buffer;
  }
  return Buffer.isBuffer(pdfBuffer) ? pdfBuffer : Buffer.from(pdfBuffer || Buffer.alloc(0));
}
