import { useParams, useSearchParams } from "react-router";
import { BuildsListPage } from "./builds-list-page.tsx";
import { BuildDetailPage } from "./build-detail-page.tsx";

export function BuildsWorkspace({
  instance,
  refreshToken,
}: {
  instance: string;
  refreshToken: string;
}) {
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();

  if (id) {
    return (
      <BuildDetailPage
        activeInstance={instance}
        id={id}
        refreshToken={refreshToken}
        searchParams={searchParams}
      />
    );
  }

  return (
    <BuildsListPage
      instance={instance}
      refreshToken={refreshToken}
      searchParams={searchParams}
      setSearchParams={setSearchParams}
    />
  );
}
