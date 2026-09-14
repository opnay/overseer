import { useCallback, useEffect, useState } from "react";

export function useUrlSection<Section extends string>({
  defaultValue,
  locationKey,
  parameter = "section",
  values,
}: {
  defaultValue: Section;
  locationKey?: string;
  parameter?: string;
  values: ReadonlyArray<Section>;
}): [Section, (section: Section) => void, (section: Section) => string] {
  const read = useCallback(() => {
    const candidate = new URLSearchParams(window.location.search).get(parameter);
    return candidate && values.includes(candidate as Section)
      ? (candidate as Section)
      : defaultValue;
  }, [defaultValue, parameter, values]);
  const [section, setSection] = useState<Section>(read);

  useEffect(() => setSection(read()), [locationKey, read]);

  useEffect(() => {
    const sync = () => setSection(read());
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [read]);

  const select = useCallback(
    (next: Section) => {
      if (next === section) return;
      const url = new URL(window.location.href);
      if (next === defaultValue) url.searchParams.delete(parameter);
      else url.searchParams.set(parameter, next);
      window.history.pushState(null, "", `${url.pathname}${url.search}${url.hash}`);
      setSection(next);
    },
    [defaultValue, parameter, section],
  );

  const getHref = useCallback(
    (next: Section) => {
      const url = new URL(window.location.href);
      if (next === defaultValue) url.searchParams.delete(parameter);
      else url.searchParams.set(parameter, next);
      return `${url.pathname}${url.search}${url.hash}`;
    },
    [defaultValue, parameter],
  );

  return [section, select, getHref];
}
