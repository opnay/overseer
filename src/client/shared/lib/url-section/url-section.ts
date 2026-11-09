import { useLocation, useNavigate, useSearchParams } from "react-router";

export function useUrlSection<Section extends string>({
  defaultValue,
  parameter = "section",
  values,
}: {
  defaultValue: Section;
  parameter?: string;
  values: ReadonlyArray<Section>;
}): [Section, (section: Section) => void, (section: Section) => string] {
  const location = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const candidate = params.get(parameter);
  const section =
    candidate && values.includes(candidate as Section) ? (candidate as Section) : defaultValue;

  const getHref = (next: Section) => {
    const search = new URLSearchParams(params);
    if (next === defaultValue) search.delete(parameter);
    else search.set(parameter, next);
    const query = search.toString();
    return `${location.pathname}${query ? `?${query}` : ""}${location.hash}`;
  };

  const select = (next: Section) => {
    if (next !== section) void navigate(getHref(next));
  };

  return [section, select, getHref];
}
