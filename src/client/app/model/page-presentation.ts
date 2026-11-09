import {
  APP_SETTINGS_SECTIONS,
  composeProjectDetailPath,
  getAppDetailLocation,
  getAppRoute,
  type AppLocationPath,
} from "@/shared/routes";
import type { DashboardSnapshot, ImageRepositoryDetail } from "@contracts/contracts.ts";

export function pagePresentation(
  resourcePath: AppLocationPath,
  navigationSearch: string,
  dashboard?: DashboardSnapshot,
  imageRepositoryHeader?: ImageRepositoryDetail,
) {
  const currentDetail = getAppDetailLocation(resourcePath);
  const currentRoute = getAppRoute(resourcePath);
  const currentContainer =
    currentDetail?.type === "container"
      ? dashboard?.containers.find(
          ({ id, name }) =>
            id === currentDetail.identifier ||
            name === currentDetail.identifier ||
            id.startsWith(currentDetail.identifier) ||
            currentDetail.identifier.startsWith(id),
        )
      : undefined;
  const currentImage =
    currentDetail?.type === "image"
      ? dashboard?.images.find(({ id }) => id === currentDetail.identifier)
      : undefined;
  const currentNetwork =
    currentDetail?.type === "network"
      ? dashboard?.networks.find(({ name }) => name === currentDetail.identifier)
      : undefined;
  const currentVolume =
    currentDetail?.type === "volume"
      ? dashboard?.volumes.find(({ name }) => name === currentDetail.identifier)
      : undefined;
  const currentVolumeAnonymous =
    currentVolume?.labels
      .split(",")
      .some((label) => label.split("=", 1)[0]?.trim() === "com.docker.volume.anonymous") ?? false;
  const requestedSettingsSection = new URLSearchParams(navigationSearch).get("section");
  const settingsSection =
    APP_SETTINGS_SECTIONS.find(({ value }) => value === requestedSettingsSection)?.value ??
    (dashboard?.runtime.phase === "running" ? "general" : "engine");
  const settingsPresentation = APP_SETTINGS_SECTIONS.find(
    ({ value }) => value === settingsSection,
  )!;
  const pageEyebrow =
    currentRoute.path === "/settings" && settingsSection !== "general"
      ? "엔진"
      : currentRoute.eyebrow;
  const pageLabel = currentDetail
    ? currentDetail.type === "compose"
      ? currentDetail.identifier
      : currentDetail.type === "container"
        ? (currentContainer?.name ?? currentDetail.identifier)
        : currentDetail.type === "image" && currentImage
          ? currentImage.tag === "<none>"
            ? currentImage.repository
            : `${currentImage.repository}:${currentImage.tag}`
          : currentDetail.type === "imageRepository"
            ? (imageRepositoryHeader?.repository ?? currentDetail.identifier)
            : currentDetail.type === "instance"
              ? currentDetail.identifier
              : currentDetail.type === "network"
                ? (currentNetwork?.name ?? currentDetail.identifier)
                : currentDetail.type === "volume"
                  ? currentVolumeAnonymous
                    ? "docker:anonymous"
                    : (currentVolume?.name ?? currentDetail.identifier)
                  : currentDetail.identifier
    : currentRoute.path === "/settings"
      ? settingsPresentation.label
      : currentRoute.label;
  const pageDescription = currentDetail
    ? currentDetail.type === "compose"
      ? "서비스 운영과 Compose 구성을 한곳에서 관리합니다."
      : currentDetail.type === "container"
        ? "실행 중인 컨테이너의 운영·진단 정보를 관리합니다."
        : currentDetail.type === "image"
          ? "이미지의 출처, 실행 기본값과 레이어를 탐색합니다."
          : currentDetail.type === "imageRepository"
            ? "원격 태그를 탐색하고 이미지 다운로드·즐겨찾기·컨테이너 생성을 관리합니다."
            : currentDetail.type === "instance"
              ? "Lima VM과 Docker Engine 연결을 관리합니다."
              : currentDetail.type === "network"
                ? "Docker 네트워크의 연결 관계와 원본 구성을 탐색합니다."
                : currentVolumeAnonymous
                  ? currentDetail.identifier
                  : undefined
    : currentRoute.path === "/settings"
      ? settingsPresentation.description
      : currentRoute.description;
  const detailBreadcrumbs: Array<{ label: string; path?: AppLocationPath }> = currentDetail
    ? currentDetail.type === "container" && currentContainer?.composeProject
      ? [
          { label: "Compose", path: "/compose" as const },
          {
            label: currentContainer.composeProject,
            path: composeProjectDetailPath(currentContainer.composeProject),
          },
          { label: pageLabel },
        ]
      : [{ label: currentRoute.label, path: currentDetail.parentPath }, { label: pageLabel }]
    : [];
  return {
    currentDetail,
    currentRoute,
    currentContainer,
    currentVolumeAnonymous,
    settingsSection,
    pageEyebrow,
    pageLabel,
    pageDescription,
    detailBreadcrumbs,
  };
}
