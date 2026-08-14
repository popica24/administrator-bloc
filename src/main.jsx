import React from "react";
import { createRoot } from "react-dom/client";

import AdminBloc from "./AdminBloc.jsx";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AdminBloc />
  </React.StrictMode>
);
