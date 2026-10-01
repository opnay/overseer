import { Button } from "@opnay/city-ds-react/button";
import { Drawer } from "@opnay/city-ds-react/drawer";
import { Tooltip } from "@opnay/city-ds-react/tooltip";
import {
  ArrowLeft,
  Boxes,
  Cloud,
  Container,
  Database,
  HardDrive,
  Layers3,
  ListChecks,
  Menu,
  Network,
  Puzzle,
  Server,
  Settings2,
  Terminal,
  X,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { followLink } from "@/shared/lib/follow-link";
import {
  APP_ROUTES,
  APP_ROUTE_GROUPS,
  getAppRoute,
  type AppDetailLocation,
  type AppPath,
  type AppRouteGroup,
} from "@/shared/routes";
import { WorkspaceNavigationOutlet } from "@/shared/ui/sectioned-workspace";

type NavigationItem = { href: string; label: string; icon: LucideIcon };

const routeIcons = {
  "/compose": Layers3,
  "/containers": Boxes,
  "/docker-plugins": Puzzle,
  "/images": HardDrive,
  "/image-repositories": Cloud,
  "/instances": Server,
  "/networks": Network,
  "/operations": ListChecks,
  "/settings": Settings2,
  "/volumes": Database,
} satisfies Record<AppPath, LucideIcon>;

const groupIcons = { docker: Container, engine: Server, providers: Cloud, cli: Terminal };
const utilities: NavigationItem[] = [
  { href: "/operations", label: "작업 기록", icon: ListChecks },
  { href: "/settings?section=general", label: "일반 설정", icon: Settings2 },
];

function groupItems(group: AppRouteGroup): NavigationItem[] {
  if (group === "utility") return [];
  const items = APP_ROUTES.filter((route) => route.group === group).map((route) => ({
    href: route.path,
    label: route.label,
    icon: routeIcons[route.path],
  }));
  if (group !== "engine") return items;
  return [
    ...items,
    { href: "/settings?section=engine", label: "엔진 설정", icon: Settings2 },
    { href: "/settings?section=network", label: "네트워크 설정", icon: Network },
  ];
}

function isCurrent(item: NavigationItem, currentPath: AppPath, settingsSection: string) {
  const [path, search] = item.href.split("?");
  if (path !== currentPath) return false;
  if (path !== "/settings") return true;
  return new URLSearchParams(search).get("section") === settingsSection;
}

function NavigationLink({
  item,
  current,
  iconOnly = false,
  onNavigate,
}: {
  item: NavigationItem;
  current: boolean;
  iconOnly?: boolean;
  onNavigate(href: string): void;
}) {
  const Icon = item.icon;
  const link = (
    <a
      aria-current={current ? "page" : undefined}
      aria-label={iconOnly ? item.label : undefined}
      href={item.href}
      onClick={(event) => followLink(event, () => onNavigate(item.href))}
    >
      <Icon aria-hidden="true" size={iconOnly ? 18 : 16} />
      {!iconOnly ? <span>{item.label}</span> : null}
    </a>
  );
  if (!iconOnly) return link;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={
          <Button
            iconOnly
            nativeButton={false}
            role="link"
            render={link}
            size="xlg"
            variant={current ? "secondary" : "ghost"}
          />
        }
      />
      <Tooltip.Portal>
        <Tooltip.Positioner side="right" sideOffset={8}>
          <Tooltip.Popup>{item.label}</Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function AppSidebar({
  currentPath,
  detail,
  detailLabel,
  mode,
  onNavigate,
  settingsSection,
}: {
  currentPath: AppPath;
  detail?: AppDetailLocation;
  detailLabel: string;
  mode: "desktop" | "rail";
  onNavigate(href: string): void;
  settingsSection: string;
}) {
  const route = getAppRoute(currentPath);
  const currentGroup: AppRouteGroup =
    currentPath === "/settings" && settingsSection !== "general" ? "engine" : route.group;
  const group = currentGroup;
  const contextVisible = Boolean(detail || currentPath === "/settings");
  const groupLabel = APP_ROUTE_GROUPS.find(({ id }) => id === group)?.label;
  const title =
    contextVisible && detail
      ? detailLabel
      : (groupLabel ?? (currentPath === "/settings" ? "일반 설정" : "작업 기록"));
  const items = groupItems(group).filter(
    (item) => !contextVisible || currentPath !== "/settings" || item.href === "/instances",
  );

  return (
    <aside aria-label="Overseer 주요 탐색" className="overseer-sidebar" data-navigation-mode={mode}>
      <div className="overseer-category-rail">
        <span aria-hidden="true" className="overseer-rail-brand">
          <Container size={22} />
        </span>
        <nav aria-label="영역 선택" className="overseer-category-navigation">
          {APP_ROUTE_GROUPS.map((category) => {
            const Icon = groupIcons[category.id];
            const selected = category.id === group;
            return (
              <Tooltip.Root key={category.id}>
                <Tooltip.Trigger
                  render={
                    <Button
                      aria-label={category.label}
                      aria-pressed={selected}
                      iconOnly
                      onClick={() => onNavigate(groupItems(category.id)[0]!.href)}
                      size="xlg"
                      variant={selected ? "secondary" : "ghost"}
                    />
                  }
                >
                  <Icon aria-hidden="true" size={20} strokeWidth={selected ? 2.5 : 1.75} />
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Positioner side="right" sideOffset={8}>
                    <Tooltip.Popup>{category.label}</Tooltip.Popup>
                  </Tooltip.Positioner>
                </Tooltip.Portal>
              </Tooltip.Root>
            );
          })}
        </nav>
        <nav aria-label="유틸리티 메뉴" className="overseer-rail-utilities">
          {utilities.map((item) => (
            <NavigationLink
              current={isCurrent(item, currentPath, settingsSection)}
              iconOnly
              item={item}
              key={item.href}
              onNavigate={onNavigate}
            />
          ))}
        </nav>
      </div>

      <div className="overseer-secondary-sidebar">
        <header className="overseer-secondary-heading">
          <span>Overseer</span>
          <strong title={title}>{title}</strong>
        </header>
        {contextVisible && detail ? (
          <a
            aria-label={`${route.label} 목록으로`}
            className="overseer-navigation-back"
            href={detail.parentPath}
            onClick={(event) => followLink(event, () => onNavigate(detail.parentPath))}
          >
            <ArrowLeft aria-hidden="true" size={16} />
            목록으로
          </a>
        ) : null}
        {!contextVisible || currentPath === "/settings" ? (
          <nav aria-label="주요 메뉴" className="overseer-secondary-navigation">
            {items.map((item) => (
              <NavigationLink
                current={isCurrent(item, currentPath, settingsSection)}
                item={item}
                key={item.href}
                onNavigate={onNavigate}
              />
            ))}
          </nav>
        ) : null}
        {contextVisible && detail?.type === "imageRepository" ? (
          <nav aria-label="이미지 저장소 상세 메뉴" className="overseer-secondary-navigation">
            <a aria-current="page" href={detail.path}>
              태그
            </a>
          </nav>
        ) : null}
        <WorkspaceNavigationOutlet hidden={!contextVisible || detail?.type === "imageRepository"} />
      </div>
    </aside>
  );
}

export function MobileNavigationDrawer({
  currentPath,
  onNavigate,
  settingsSection,
}: {
  currentPath: AppPath;
  onNavigate(href: string): void;
  settingsSection: string;
}) {
  const [open, setOpen] = useState(false);
  const navigate = (href: string) => {
    setOpen(false);
    onNavigate(href);
  };
  return (
    <Drawer.Root modal onOpenChange={setOpen} open={open} swipeDirection="left">
      <Drawer.Trigger
        render={<Button aria-label="주요 메뉴 열기" iconOnly size="sm" variant="ghost" />}
      >
        <Menu aria-hidden="true" size={17} />
      </Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Backdrop />
        <Drawer.Viewport side="left">
          <Drawer.Popup side="left" size="sm">
            <Drawer.Header>
              <div>
                <Drawer.Title>주요 메뉴</Drawer.Title>
                <Drawer.Description>Overseer 전역 화면으로 이동합니다.</Drawer.Description>
              </div>
              <Drawer.Close
                render={<Button aria-label="주요 메뉴 닫기" iconOnly size="sm" variant="ghost" />}
              >
                <X aria-hidden="true" size={16} />
              </Drawer.Close>
            </Drawer.Header>
            <Drawer.Content className="overseer-mobile-navigation-body">
              <nav aria-label="주요 메뉴" className="overseer-navigation">
                {APP_ROUTE_GROUPS.map((group) => (
                  <div
                    aria-label={group.label}
                    className="overseer-nav-group"
                    key={group.id}
                    role="group"
                  >
                    <span className="overseer-nav-group-label">{group.label}</span>
                    <div className="overseer-nav-group-items">
                      {groupItems(group.id).map((item) => (
                        <NavigationLink
                          current={isCurrent(item, currentPath, settingsSection)}
                          item={item}
                          key={item.href}
                          onNavigate={navigate}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </nav>
              <nav aria-label="유틸리티 메뉴" className="overseer-sidebar-utility">
                {utilities.map((item) => (
                  <NavigationLink
                    current={isCurrent(item, currentPath, settingsSection)}
                    item={item}
                    key={item.href}
                    onNavigate={navigate}
                  />
                ))}
              </nav>
            </Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
