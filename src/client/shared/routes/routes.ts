export const APP_ROUTE_GROUPS = [
  { id: "workloads", label: "워크로드" },
  { id: "resources", label: "리소스" },
  { id: "virtualization", label: "가상화" },
  { id: "external", label: "외부 공급자" },
  { id: "extensions", label: "CLI" },
  { id: "operations", label: "운영" },
] as const;

export type AppRouteGroup = (typeof APP_ROUTE_GROUPS)[number]["id"] | "utility";

export const APP_ROUTES = [
  {
    description: "실행 이력과 폼·URL Compose 프로젝트, 서비스 상태를 함께 관리합니다.",
    eyebrow: "COMPOSE 프로젝트",
    group: "workloads",
    label: "Compose",
    path: "/compose",
  },
  {
    description: "실행 상태와 로컬 공개 포트를 확인하고 컨테이너를 제어합니다.",
    eyebrow: "컨테이너 관리",
    group: "workloads",
    label: "컨테이너",
    path: "/containers",
  },
  {
    description: "Docker Engine에 저장된 로컬 이미지와 크기를 확인하고 관리합니다.",
    eyebrow: "이미지 보관함",
    group: "resources",
    label: "이미지",
    path: "/images",
  },
  {
    description: "컨테이너와 독립적으로 유지되는 로컬 데이터를 관리합니다.",
    eyebrow: "영구 데이터",
    group: "resources",
    label: "볼륨",
    path: "/volumes",
  },
  {
    description: "컨테이너 간 통신에 사용하는 Docker 네트워크를 관리합니다.",
    eyebrow: "Docker 네트워크",
    group: "resources",
    label: "네트워크",
    path: "/networks",
  },
  {
    description: "외부 이미지 저장소를 등록하고 태그 정보를 동기화합니다.",
    eyebrow: "외부 공급자",
    group: "external",
    label: "이미지 저장소",
    path: "/image-repositories",
  },
  {
    description: "Docker CLI에서 사용하는 공식 도구의 설치 상태와 버전을 관리합니다.",
    eyebrow: "Docker 도구",
    group: "extensions",
    label: "도구",
    path: "/docker-plugins",
  },
  {
    description: "Overseer에서 요청한 모든 Docker 작업과 결과를 확인합니다.",
    eyebrow: "운영 기록",
    group: "operations",
    label: "작업 기록",
    path: "/operations",
  },
  {
    description: "로컬 VM의 상태, 가상화 방식과 할당 자원을 확인하고 인스턴스를 관리합니다.",
    eyebrow: "가상화 환경",
    group: "virtualization",
    label: "인스턴스",
    path: "/instances",
  },
  {
    description: "Overseer와 Docker Engine 설정을 관리합니다.",
    eyebrow: "시스템 설정",
    group: "utility",
    label: "설정",
    path: "/settings",
  },
] as const;

export type AppPath = (typeof APP_ROUTES)[number]["path"];

export type AppLocationPath =
  | AppPath
  | `/compose/${string}`
  | `/containers/${string}`
  | `/images/${string}`
  | `/image-repositories/${string}`
  | `/instances/${string}`
  | `/networks/${string}`
  | `/volumes/${string}`;

export type AppDetailLocation =
  | { identifier: string; parentPath: "/compose"; path: `/compose/${string}`; type: "compose" }
  | {
      identifier: string;
      parentPath: "/instances";
      path: `/instances/${string}`;
      type: "instance";
    }
  | {
      identifier: string;
      parentPath: "/containers";
      path: `/containers/${string}`;
      type: "container";
    }
  | {
      identifier: string;
      parentPath: "/images";
      path: `/images/${string}`;
      type: "image";
    }
  | {
      identifier: string;
      parentPath: "/image-repositories";
      path: `/image-repositories/${string}`;
      type: "imageRepository";
    }
  | {
      identifier: string;
      parentPath: "/networks";
      path: `/networks/${string}`;
      type: "network";
    }
  | {
      identifier: string;
      parentPath: "/volumes";
      path: `/volumes/${string}`;
      type: "volume";
    };

export function composeProjectDetailPath(name: string): `/compose/${string}` {
  return `/compose/${encodeURIComponent(name)}`;
}

export function containerDetailPath(id: string): `/containers/${string}` {
  return `/containers/${encodeURIComponent(id)}`;
}

export function imageDetailPath(id: string): `/images/${string}` {
  return `/images/${encodeURIComponent(id)}`;
}

export function imageRepositoryDetailPath(id: string): `/image-repositories/${string}` {
  return `/image-repositories/${encodeURIComponent(id)}`;
}

export function runtimeInstanceDetailPath(name: string): `/instances/${string}` {
  return `/instances/${encodeURIComponent(name)}`;
}

export function networkDetailPath(name: string): `/networks/${string}` {
  return `/networks/${encodeURIComponent(name)}`;
}

export function volumeDetailPath(name: string): `/volumes/${string}` {
  return `/volumes/${encodeURIComponent(name)}`;
}

export function getAppDetailLocation(pathname: string): AppDetailLocation | undefined {
  const [, resource, encodedIdentifier, extra] = pathname.split("/");
  if (!resource || !encodedIdentifier || extra !== undefined) return undefined;
  let identifier: string;
  try {
    identifier = decodeURIComponent(encodedIdentifier);
  } catch {
    return undefined;
  }
  if (resource === "compose" && isComposeProjectName(identifier)) {
    return {
      identifier,
      parentPath: "/compose",
      path: composeProjectDetailPath(identifier),
      type: "compose",
    };
  }
  if (resource === "containers" && isContainerReference(identifier)) {
    return {
      identifier,
      parentPath: "/containers",
      path: containerDetailPath(identifier),
      type: "container",
    };
  }
  if (resource === "images" && isImageIdentifier(identifier)) {
    return {
      identifier,
      parentPath: "/images",
      path: imageDetailPath(identifier),
      type: "image",
    };
  }
  if (resource === "image-repositories" && isImageRepositoryIdentifier(identifier)) {
    return {
      identifier,
      parentPath: "/image-repositories",
      path: imageRepositoryDetailPath(identifier),
      type: "imageRepository",
    };
  }
  if (resource === "instances" && isRuntimeInstanceName(identifier)) {
    return {
      identifier,
      parentPath: "/instances",
      path: runtimeInstanceDetailPath(identifier),
      type: "instance",
    };
  }
  if (resource === "networks" && isResourceName(identifier)) {
    return {
      identifier,
      parentPath: "/networks",
      path: networkDetailPath(identifier),
      type: "network",
    };
  }
  if (resource === "volumes" && isResourceName(identifier)) {
    return {
      identifier,
      parentPath: "/volumes",
      path: volumeDetailPath(identifier),
      type: "volume",
    };
  }
  return undefined;
}

export function getAppLocation(pathname: string): AppLocationPath {
  return (
    APP_ROUTES.find((route) => route.path === pathname)?.path ??
    getAppDetailLocation(pathname)?.path ??
    "/containers"
  );
}

export function getAppRoute(pathname: string) {
  const detail = getAppDetailLocation(pathname);
  return (
    APP_ROUTES.find((route) => route.path === pathname) ??
    APP_ROUTES.find((route) => route.path === detail?.parentPath) ??
    APP_ROUTES.find((route) => route.path === "/containers")!
  );
}
import {
  isComposeProjectName,
  isContainerReference,
  isImageIdentifier,
  isImageRepositoryIdentifier,
  isResourceName,
  isRuntimeInstanceName,
} from "@contracts/validation.ts";
