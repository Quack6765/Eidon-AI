import { useEffect, useState } from "react";

export type PersonaOption = { id: string; name: string };

export function usePersonas() {
  const [personas, setPersonas] = useState<PersonaOption[]>([]);
  useEffect(() => {
    fetch("/api/personas")
      .then((response) => response.json())
      .then((payload: { personas?: PersonaOption[] }) => {
        if (payload.personas) setPersonas(payload.personas);
      })
      .catch(() => undefined);
  }, []);
  return personas;
}
