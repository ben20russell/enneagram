import test from "node:test";
import assert from "node:assert/strict";
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName } from "pdf-lib";

const sanitizePdfModuleUrl = new URL("../lib/pdfSanitize.js", import.meta.url);

function uniqueModuleUrl() {
  return `${sanitizePdfModuleUrl.href}?v=${Date.now()}-${Math.random()}`;
}

async function buildPdfWithAnnotationsFormsAndExtras() {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([420, 300]);
  page.drawText("Sanitize me", { x: 24, y: 264, size: 14 });

  const fakeAnnotationArray = pdfDoc.context.obj([]);
  fakeAnnotationArray.push(
    pdfDoc.context.obj({
      Type: PDFName.of("Annot"),
      Subtype: PDFName.of("Highlight"),
      Rect: pdfDoc.context.obj([20, 250, 180, 270]),
      Contents: PDFHexString.fromText("marker"),
    }),
  );
  page.node.set(PDFName.of("Annots"), fakeAnnotationArray);

  const form = pdfDoc.getForm();
  const textField = form.createTextField("client_name");
  textField.setText("Ben");
  textField.addToPage(page, { x: 24, y: 220, width: 140, height: 18 });

  const namesDict = pdfDoc.context.obj({});
  namesDict.set(PDFName.of("EmbeddedFiles"), pdfDoc.context.obj([]));
  namesDict.set(PDFName.of("JavaScript"), pdfDoc.context.obj([]));
  pdfDoc.catalog.set(PDFName.of("Names"), namesDict);

  pdfDoc.catalog.set(
    PDFName.of("OpenAction"),
    pdfDoc.context.obj({
      S: PDFName.of("JavaScript"),
      JS: PDFHexString.fromText("app.alert('x')"),
    }),
  );
  pdfDoc.catalog.set(PDFName.of("AA"), pdfDoc.context.obj({}));
  pdfDoc.catalog.set(PDFName.of("AF"), pdfDoc.context.obj([]));
  pdfDoc.catalog.set(PDFName.of("Metadata"), pdfDoc.context.obj({}));
  pdfDoc.setTitle("Noisy Title");
  pdfDoc.setAuthor("Noisy Author");

  return Buffer.from(await pdfDoc.save());
}

test("sanitizePdfForParsing removes annotations, flattens form fields, and strips non-content extras by default", async () => {
  const { sanitizePdfForParsing } = await import(uniqueModuleUrl());
  const inputPdfBuffer = await buildPdfWithAnnotationsFormsAndExtras();

  const result = await sanitizePdfForParsing(inputPdfBuffer, {
    source: "test-default",
  });

  assert.equal(Buffer.isBuffer(result?.buffer), true);
  assert.equal(result?.diagnostics?.annotationCleanupEnabled, true);
  assert.equal(result?.diagnostics?.formFieldMode, "flatten");
  assert.equal(result?.diagnostics?.stripNonContentExtras, true);
  assert.ok(
    Number(result?.diagnostics?.annotationObjectsRemoved || 0) > 0,
    "Expected sanitization diagnostics to report removed annotation objects",
  );
  assert.ok(
    Number(result?.diagnostics?.formFieldsFlattened || 0) > 0,
    "Expected sanitization diagnostics to report flattened form fields",
  );
  assert.equal(Number(result?.diagnostics?.formFieldsRemoved || 0), 0);
  assert.equal(result?.diagnostics?.metadataCleared, true);

  const sanitizedDoc = await PDFDocument.load(result.buffer, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  const annots = sanitizedDoc.getPages()[0].node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  assert.ok(!annots || (typeof annots.size === "function" && annots.size() === 0));
  assert.equal(sanitizedDoc.getForm().getFields().length, 0);
  assert.equal(sanitizedDoc.catalog.has(PDFName.of("OpenAction")), false);
  assert.equal(sanitizedDoc.catalog.has(PDFName.of("AA")), false);
  assert.equal(sanitizedDoc.catalog.has(PDFName.of("AF")), false);

  const names = sanitizedDoc.catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
  assert.ok(
    !names || (!names.has(PDFName.of("EmbeddedFiles")) && !names.has(PDFName.of("JavaScript"))),
    "Expected sanitizer to strip embedded files and javascript entries from catalog names",
  );
});

test("sanitizePdfForParsing supports flatten mode for form fields", async () => {
  const { sanitizePdfForParsing } = await import(uniqueModuleUrl());
  const inputPdfBuffer = await buildPdfWithAnnotationsFormsAndExtras();

  const result = await sanitizePdfForParsing(inputPdfBuffer, {
    source: "test-flatten",
    formFieldMode: "flatten",
  });

  assert.equal(result?.diagnostics?.formFieldMode, "flatten");
  assert.ok(
    Number(result?.diagnostics?.formFieldsFlattened || 0) > 0,
    "Expected sanitization diagnostics to report flattened form fields in flatten mode",
  );
  const sanitizedDoc = await PDFDocument.load(result.buffer, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  assert.equal(sanitizedDoc.getForm().getFields().length, 0);
});

test("sanitizePdfForParsing resolves legacy remove mode to flatten", async () => {
  const { sanitizePdfForParsing } = await import(uniqueModuleUrl());
  const inputPdfBuffer = await buildPdfWithAnnotationsFormsAndExtras();

  const result = await sanitizePdfForParsing(inputPdfBuffer, {
    source: "test-remove-alias",
    formFieldMode: "remove",
  });

  assert.equal(result?.diagnostics?.formFieldMode, "flatten");
  assert.ok(
    Number(result?.diagnostics?.formFieldsFlattened || 0) > 0,
    "Expected legacy remove mode requests to be upgraded to flatten mode",
  );
  assert.equal(Number(result?.diagnostics?.formFieldsRemoved || 0), 0);
});

test("sanitizePdfForParsing safely falls back to original bytes for invalid pdf buffers", async () => {
  const { sanitizePdfForParsing } = await import(uniqueModuleUrl());
  const invalidPdf = Buffer.from("not-a-real-pdf");

  const result = await sanitizePdfForParsing(invalidPdf, {
    source: "test-invalid",
  });

  assert.equal(Buffer.isBuffer(result?.buffer), true);
  assert.equal(result.buffer.equals(invalidPdf), true);
  assert.equal(result?.sanitized, false);
  assert.match(
    String(result?.diagnostics?.reason || ""),
    /sanitize_failed/i,
  );
});

test("sanitizePdfForParsingBuffer returns a flattened sanitized PDF buffer", async () => {
  const { sanitizePdfForParsingBuffer } = await import(uniqueModuleUrl());
  const inputPdfBuffer = await buildPdfWithAnnotationsFormsAndExtras();

  const sanitizedBuffer = await sanitizePdfForParsingBuffer(inputPdfBuffer, {
    source: "test-buffer-helper",
  });

  assert.equal(Buffer.isBuffer(sanitizedBuffer), true);

  const sanitizedDoc = await PDFDocument.load(sanitizedBuffer, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  assert.equal(sanitizedDoc.getForm().getFields().length, 0);
});
