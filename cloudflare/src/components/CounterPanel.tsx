import type { useHost } from "../plugin/host";
import { DISPLAY_NAME } from "../plugin/config";
import { WEBSITE_URL, REPOSITORY_URL } from "../site.config";
import mark from "../assets/codesk.svg";
import Background from "./design/Background";
import Grad from "./design/Grad";

export default function CounterPanel({
  host,
  value,
  status,
}: {
  host: ReturnType<typeof useHost>;
  value: number | null;
  status: string;
}) {
  const fullscreen = host.mode === "fullscreen";
  return (
    <main
      className={`plugin-shell rgb-shift ${host.embedded ? "is-embedded" : ""}`}
      data-mode={host.mode}
    >
      <Background />
      <div className="plugin-content">
        <header className="plugin-header">
          <div className="plugin-brand">
            <img src={mark} width="32" height="32" alt="" />
            <div>
              <h1>{DISPLAY_NAME}</h1>
              <p>Your personal AI desk</p>
            </div>
          </div>
          <button
            type="button"
            className="panel-button"
            onClick={() => void host.toggleFullscreen()}
            disabled={host.pending}
            aria-busy={host.pending}
            aria-pressed={fullscreen}
          >
            <span aria-hidden="true">⛶</span>{" "}
            {fullscreen
              ? host.embedded
                ? "Return to inline"
                : "Exit fullscreen"
              : "Open fullscreen"}
          </button>
        </header>
        <section
          className="counter-card corner-frame"
          aria-label="Counter example"
        >
          {["tl", "tr", "bl", "br"].map((corner) => (
            <span
              key={corner}
              aria-hidden="true"
              className={`frame-corner frame-${corner} border-fade-${corner}`}
            />
          ))}
          <div className="counter-label">
            <h2>Counter</h2>
            <span className="connection-label">
              {host.embedded ? "Live WebSocket state" : "Unconnected preview"}
            </span>
          </div>
          <div className="counter-display">
            <p>Current value</p>
            <output aria-label="Counter value" aria-live="polite">
              <Grad text={`<g>${value ?? "—"}</g>`} />
            </output>
          </div>
          <div className="counter-status">
            <p role="status">
              {host.embedded
                ? status
                : "Open the installed plugin in Codex to connect a session."}
            </p>
            {host.error && <p role="alert">{host.error}</p>}
          </div>
        </section>
        <p className="plugin-hint">
          {host.embedded
            ? "Ask in the native Codex composer: “Set the counter to 5.”"
            : "This browser preview has no active run."}
        </p>
        <footer className="plugin-footer">
          {WEBSITE_URL && <a
            href={WEBSITE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="floating-underline"
          >
            Website ↗
          </a>}
          <a
            href={REPOSITORY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="floating-underline"
          >
            Source ↗
          </a>
        </footer>
      </div>
    </main>
  );
}
