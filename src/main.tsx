import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import BootError from "./components/chrome/BootError";
import { boot } from "./lib/boot";
import "./tailwind.css";

/* API §5.1 boot sequence: the contract gate runs BEFORE App mounts —
   a mismatched or unreachable core never renders the app shell. */

const container = document.getElementById("root") as HTMLElement;

void boot().then((result) => {
  if (result.ok) {
    ReactDOM.createRoot(container).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  } else {
    ReactDOM.createRoot(container).render(
      <React.StrictMode>
        <BootError
          userMessage={result.error.userMessage}
          expected={result.expected}
          actual={result.actual}
        />
      </React.StrictMode>,
    );
  }
});
