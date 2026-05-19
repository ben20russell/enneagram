import PopupAuthBridge from "./components/PopupAuthBridge";

export default function HomePage() {
  console.log("[home] Rendering embedded report page");

  return (
    <main style={{ width: "100vw", minHeight: "100vh", margin: 0, padding: 0 }}>
      <PopupAuthBridge />
      <iframe
        title="Enneagram Report"
        src="/report.html"
        style={{ width: "100%", minHeight: "100vh", border: 0 }}
      />
    </main>
  );
}
