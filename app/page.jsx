import PopupAuthBridge from "./components/PopupAuthBridge";

export default async function HomePage() {
  console.log("[home] Rendering main page with example dashboard");

  return (
    <main className="report-shell" data-testid="home-root">
      <PopupAuthBridge />
      <iframe
        title="Enneagram Example Dashboard"
        src="/report.html"
        className="report-frame"
        data-testid="report-frame"
      />
    </main>
  );
}
