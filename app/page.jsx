import PopupAuthBridge from "./components/PopupAuthBridge";

export default async function HomePage() {
  console.log("[home] Rendering full example report dashboard as main page");

  return (
    <main style={{ width: "100vw", minHeight: "100vh", margin: 0, padding: 0 }} data-testid="home-root">
      <PopupAuthBridge />
      <iframe
        title="Enneagram Example Dashboard"
        src="/report.html"
        style={{ width: "100%", minHeight: "100vh", border: 0 }}
      />
    </main>
  );
}
