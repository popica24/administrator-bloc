/* Intrarea paginii publice cum-functioneaza/, separata de aplicatie */
import React from "react";
import { createRoot } from "react-dom/client";

import PaginaPublica from "./pagina-publica.jsx";
import "./pagina-publica.css";

createRoot(document.getElementById("pagina")).render(
  <React.StrictMode>
    <PaginaPublica />
  </React.StrictMode>
);
