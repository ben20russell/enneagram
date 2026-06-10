import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const reportHtmlPath = path.join(repoRoot, "public", "report.html");
const reportJsPath = path.join(repoRoot, "public", "report.js");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function toPoint(cx, cy, radius, angleDeg) {
  const radians = (angleDeg - 90) * Math.PI / 180;
  return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) };
}

function minDistanceFromRectToPoint(rect, pointX, pointY) {
  const dx = Math.max(rect.xMin - pointX, 0, pointX - rect.xMax);
  const dy = Math.max(rect.yMin - pointY, 0, pointY - rect.yMax);
  return Math.hypot(dx, dy);
}

function estimateRoleLabelRect({ x, y, text, textAnchor, fontSize }) {
  const safeText = String(text || "");
  const safeAnchor = textAnchor === "start" ? "start" : "end";
  const size = Number.isFinite(fontSize) ? fontSize : 10;
  const averageCharWidth = size * 0.68;
  const letterSpacing = size * 0.05;
  const textWidth = (safeText.length * averageCharWidth) + (Math.max(0, safeText.length - 1) * letterSpacing);
  const textHeight = size * 1.1;
  return {
    xMin: safeAnchor === "start" ? x : x - textWidth,
    xMax: safeAnchor === "start" ? x + textWidth : x,
    yMin: y - (textHeight / 2),
    yMax: y + (textHeight / 2),
  };
}

test("profile wheel removes external legend container when labels are integrated into the chart", () => {
  const html = read(reportHtmlPath);

  assert.doesNotMatch(
    html,
    /id="profileWheelLegend"/,
    "Expected profile wheel card to remove the right-side legend container.",
  );

  assert.doesNotMatch(
    html,
    /profile-wheel-legend/,
    "Expected profile wheel markup to avoid standalone legend classes once labels move in-wheel.",
  );
});

test("profile wheel render flow no longer hydrates external legend value anchors", () => {
  const script = read(reportJsPath);

  assert.doesNotMatch(
    script,
    /profileWheelLegendMain|profileWheelLegendRelease|profileWheelLegendStretch/,
    "Expected profile wheel renderer to avoid legacy external legend hydration.",
  );
});

test("profile wheel SVG injects only Release/Stretch labels and omits Main label", () => {
  const script = read(reportJsPath);

  assert.match(
    script,
    /<text class="profile-wheel-role\s+profile-wheel-role-\$\{role\.key\}"/,
    "Expected wheel SVG markup to include integrated role labels.",
  );

  assert.match(
    script,
    /label:\s*"RELEASE"[\s\S]*label:\s*"STRETCH"/,
    "Expected wheel renderer to declare Release/Stretch role label copy.",
  );

  assert.doesNotMatch(
    script,
    /label:\s*"MAIN"/,
    "Expected wheel renderer to omit the Main role label.",
  );
});

test("profile wheel role labels are positioned outside the wheel ring", () => {
  const script = read(reportJsPath);

  assert.match(
    script,
    /const\s+roleLabelRadius\s*=\s*outerRadius\s*\+\s*\d+\s*;/,
    "Expected role labels to use a radius outside the outer ring.",
  );
});

test("profile wheel role labels anchor outward so text never intrudes into the wheel", () => {
  const script = read(reportJsPath);

  assert.match(
    script,
    /const\s+outwardX\s*=\s*rolePoint\.x\s*-\s*cx\s*;/,
    "Expected role labels to derive outward direction from wheel center-relative coordinates.",
  );

  assert.match(
    script,
    /const\s+outwardUnitX\s*=\s*outwardX\s*\/\s*outwardLength\s*;/,
    "Expected role labels to normalize the outward vector before nudging labels.",
  );

  assert.match(
    script,
    /const\s+textAnchor\s*=\s*outwardUnitX\s*>?=\s*0\s*\?\s*"start"\s*:\s*"end"\s*;/,
    "Expected role labels to anchor away from the wheel center.",
  );

  assert.match(
    script,
    /const\s+roleLabelX\s*=\s*rolePoint\.x\s*\+\s*\(outwardUnitX\s*\*\s*role\.xNudge\)\s*;/,
    "Expected role labels to apply an outward x-offset beyond the ring radius.",
  );

  assert.doesNotMatch(
    script,
    /Math\.cos\(\(roleAngle\s*\*\s*Math\.PI\)\s*\/\s*180\)\s*>?=\s*0/,
    "Expected role label direction to avoid roleAngle-only trig because the wheel coordinate system is rotated.",
  );

  assert.match(
    script,
    /text-anchor="\$\{textAnchor\}"/,
    "Expected role label SVG text nodes to use computed outward anchoring instead of centered text.",
  );
});

test("profile wheel role label geometry clears the wheel across all nine canonical type layouts", () => {
  const typeOrder = ["8", "9", "1", "2", "3", "4", "5", "6", "7"];
  const canonicalByType = {
    "1": { release: "4", stretch: "7" },
    "2": { release: "8", stretch: "4" },
    "3": { release: "9", stretch: "6" },
    "4": { release: "2", stretch: "1" },
    "5": { release: "7", stretch: "8" },
    "6": { release: "3", stretch: "9" },
    "7": { release: "1", stretch: "5" },
    "8": { release: "5", stretch: "2" },
    "9": { release: "6", stretch: "3" },
  };
  const roleLabelConfig = [
    { key: "release", label: "RELEASE", angleOffset: -6, radialOffset: 0, xNudge: 10, yNudge: 4 },
    { key: "stretch", label: "STRETCH", angleOffset: 6, radialOffset: 10, xNudge: 10, yNudge: 4 },
  ];
  const cx = 292;
  const cy = 166;
  const outerRadius = 142;
  const roleLabelRadius = outerRadius + 24;
  const startAngle = -170;
  const segmentAngle = 360 / typeOrder.length;
  const minGap = 2;
  const maxGap = 45;

  Object.entries(canonicalByType).forEach(([mainType, points]) => {
    roleLabelConfig.forEach((role) => {
      const roleType = role.key === "release" ? points.release : points.stretch;
      const roleIndex = typeOrder.indexOf(roleType);
      assert.notEqual(roleIndex, -1, `Expected ${role.key} type ${roleType} to exist in profile wheel order.`);
      const roleAngle = startAngle + ((roleIndex + 0.5) * segmentAngle) + role.angleOffset;
      const rolePoint = toPoint(cx, cy, roleLabelRadius + role.radialOffset, roleAngle);
      const outwardX = rolePoint.x - cx;
      const outwardY = rolePoint.y - cy;
      const outwardLength = Math.hypot(outwardX, outwardY) || 1;
      const outwardUnitX = outwardX / outwardLength;
      const outwardUnitY = outwardY / outwardLength;
      const textAnchor = outwardUnitX >= 0 ? "start" : "end";
      const roleLabelX = rolePoint.x + (outwardUnitX * role.xNudge);
      const roleLabelY = rolePoint.y + (outwardUnitY * role.yNudge);
      const roleRect = estimateRoleLabelRect({
        x: roleLabelX,
        y: roleLabelY,
        text: role.label,
        textAnchor,
        fontSize: 10,
      });
      const minDistance = minDistanceFromRectToPoint(roleRect, cx, cy);

      assert.ok(
        minDistance >= outerRadius + minGap,
        `Expected ${role.key.toUpperCase()} label for Type ${mainType} to clear wheel by >= ${minGap}px; got ${(
          minDistance - outerRadius
        ).toFixed(2)}px.`,
      );

      assert.ok(
        minDistance <= outerRadius + maxGap,
        `Expected ${role.key.toUpperCase()} label for Type ${mainType} to hug wheel (<= ${maxGap}px beyond edge); got ${(
          minDistance - outerRadius
        ).toFixed(2)}px.`,
      );
    });
  });
});

test("profile wheel SVG explicitly allows role labels to render outside the viewBox", () => {
  const html = read(reportHtmlPath);

  assert.match(
    html,
    /\.profile-wheel-svg\{[\s\S]*overflow:\s*visible/i,
    "Expected profile wheel SVG to allow overflow so edge labels are not clipped by the SVG viewBox.",
  );
});

test("profile wheel uses a smaller visual footprint for the chart image", () => {
  const html = read(reportHtmlPath);

  assert.match(
    html,
    /\.profile-wheel-wrap\{[\s\S]*--profile-wheel-size:\s*332px[\s\S]*min-height:\s*var\(--profile-wheel-size\)/i,
    "Expected profile wheel wrapper to define a smaller desktop wheel size token.",
  );

  assert.match(
    html,
    /@media\(max-width:700px\)\{[\s\S]*--profile-wheel-size:\s*268px/i,
    "Expected profile wheel wrapper to define a smaller mobile wheel size.",
  );
});

test("profile wheel layout keeps a centered single-column square region", () => {
  const html = read(reportHtmlPath);

  assert.match(
    html,
    /\.profile-wheel-wrap\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*var\(--profile-wheel-size\)\)/i,
    "Expected profile wheel layout to use a single centered wheel column.",
  );

  assert.match(
    html,
    /\.profile-wheel\{[\s\S]*aspect-ratio:\s*1\s*\/\s*1/i,
    "Expected profile wheel container to preserve a square aspect ratio for tighter image framing.",
  );
});

test("profile wheel renderer uses a padded square svg viewBox", () => {
  const script = read(reportJsPath);

  assert.match(
    script,
    /const\s+wheelPadding\s*=\s*\d+\s*;/,
    "Expected profile wheel renderer to define wheel padding for label-safe framing.",
  );

  assert.match(
    script,
    /viewBox="\$\{viewBoxX\}\s+\$\{viewBoxY\}\s+\$\{viewBoxSize\}\s+\$\{viewBoxSize\}"/,
    "Expected profile wheel SVG viewBox to use a square, tighter framing around wheel geometry.",
  );
});
