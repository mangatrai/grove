import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import {
  MantineProvider,
  localStorageColorSchemeManager,
} from "@mantine/core";
import "@mantine/core/styles.css";

import { App } from "./App";
import { appTheme } from "./theme";
import "./index.css";

const colorSchemeManager = localStorageColorSchemeManager({
  key: "hf_color_scheme",
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MantineProvider
      theme={appTheme}
      colorSchemeManager={colorSchemeManager}
      defaultColorScheme="auto"
    >
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </MantineProvider>
  </React.StrictMode>
);
