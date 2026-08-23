export const RESOURCE_ROUTES = [
  {
    description: "실행 이력과 URL Compose 프로젝트, 서비스 상태를 함께 관리합니다.",
    eyebrow: "COMPOSE PROJECTS",
    label: "Compose",
    path: "/compose",
  },
  {
    description: "실행 상태와 로컬 공개 포트를 확인하고 컨테이너를 제어합니다.",
    eyebrow: "CONTAINER OPERATIONS",
    label: "컨테이너",
    path: "/containers",
  },
  {
    description: "로컬 이미지와 태그, 크기를 확인하고 이미지를 관리합니다.",
    eyebrow: "IMAGE LIBRARY",
    label: "이미지",
    path: "/images",
  },
  {
    description: "컨테이너와 독립적으로 유지되는 로컬 데이터를 관리합니다.",
    eyebrow: "PERSISTENT DATA",
    label: "볼륨",
    path: "/volumes",
  },
  {
    description: "컨테이너 간 통신에 사용하는 Docker 네트워크를 관리합니다.",
    eyebrow: "NETWORKING",
    label: "네트워크",
    path: "/networks",
  },
] as const;

export type ResourcePath = (typeof RESOURCE_ROUTES)[number]["path"];

export function getResourceRoute(pathname: string) {
  return (
    RESOURCE_ROUTES.find((route) => route.path === pathname) ??
    RESOURCE_ROUTES.find((route) => route.path === "/containers")!
  );
}
