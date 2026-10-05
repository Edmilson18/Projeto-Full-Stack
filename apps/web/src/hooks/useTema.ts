import { useState, useEffect } from "react";

export function useTema() {
  const [tema, setTema] = useState<"claro" | "escuro">(() =>
    localStorage.getItem("temaLoja") === "escuro" ? "escuro" : "claro",
  );

  useEffect(() => {
    localStorage.setItem("temaLoja", tema);
    document.documentElement.dataset.tema = tema;
  }, [tema]);

  return { tema, setTema };
}
