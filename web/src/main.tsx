import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { startDemoSession } from "./lib/demo";
import "./index.css";

// 示範站：先確定這個瀏覽器的示範資料（重新整理 → 換新的一份），再畫畫面；正式站立刻略過
startDemoSession().finally(() => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
