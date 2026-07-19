// Browser entry for the injectable Agentation toolbar.
// Bundled at runtime by the extension (esbuild) and served from the local
// webhook server, so host projects never need to install or commit anything.
import { Agentation } from "agentation";
import React from "react";
import { createRoot } from "react-dom/client";

declare global {
  interface Window {
    __PI_AGENTATION__?: { webhookUrl?: string };
  }
}

const ROOT_ID = "pi-agentation-root";

const mount = (): void => {
  if (document.getElementById(ROOT_ID)) {
    console.info("pi-agentation: toolbar already mounted.");
    return;
  }

  const webhookUrl = window.__PI_AGENTATION__?.webhookUrl;
  if (!webhookUrl) {
    console.error("pi-agentation: missing webhookUrl configuration.");
    return;
  }

  const el = document.createElement("div");
  el.id = ROOT_ID;
  document.body.appendChild(el);
  createRoot(el).render(React.createElement(Agentation, { webhookUrl }));
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount, { once: true });
} else {
  mount();
}
