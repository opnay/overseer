import { Button } from "@opnay/city-ds-react/button";
import { Menu } from "@opnay/city-ds-react/menu";
import { Tooltip } from "@opnay/city-ds-react/tooltip";
import { Download, Ellipsis, Play, Star } from "lucide-react";
import {
  IMAGE_REPOSITORY_FAVORITE_LIMIT,
  type ImageRepositoryTagItem,
} from "@contracts/contracts.ts";

export function TagActions({
  favoriteBusy,
  favoriteLimitReached,
  imageBusy,
  onCreateContainer,
  onDownload,
  onFavorite,
  runtimeAvailable,
  tag,
}: {
  favoriteBusy: boolean;
  favoriteLimitReached: boolean;
  imageBusy: boolean;
  onCreateContainer(): void;
  onDownload(): Promise<void>;
  onFavorite(): Promise<void>;
  runtimeAvailable: boolean;
  tag: ImageRepositoryTagItem;
}) {
  return (
    <>
      <Tooltip.Root>
        <Tooltip.Trigger
          render={
            <Button
              aria-label={`${tag.name} 이미지 다운로드`}
              disabled={!runtimeAvailable || imageBusy}
              iconOnly
              onClick={() => void onDownload().catch(() => undefined)}
              size="sm"
              variant="ghost"
            />
          }
        >
          <Download aria-hidden="true" size={14} />
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Positioner side="top" sideOffset={6}>
            <Tooltip.Popup>이미지 다운로드</Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>

      <Tooltip.Root>
        <Tooltip.Trigger
          render={
            <Button
              aria-label={`${tag.name} ${tag.favorite ? "즐겨찾기 해제" : "즐겨찾기 추가"}`}
              aria-pressed={tag.favorite}
              disabled={favoriteBusy || (!tag.favorite && favoriteLimitReached)}
              iconOnly
              onClick={() => void onFavorite().catch(() => undefined)}
              size="sm"
              variant="ghost"
            />
          }
        >
          <Star aria-hidden="true" fill={tag.favorite ? "currentColor" : "none"} size={14} />
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Positioner side="top" sideOffset={6}>
            <Tooltip.Popup>
              {tag.favorite
                ? "즐겨찾기 해제"
                : favoriteLimitReached
                  ? `즐겨찾기는 최대 ${IMAGE_REPOSITORY_FAVORITE_LIMIT}개까지 추가할 수 있습니다.`
                  : "즐겨찾기 추가"}
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>

      <Menu.Root density="compact">
        <Tooltip.Root>
          <Tooltip.Trigger
            render={
              <Menu.Trigger
                render={
                  <Button aria-label={`${tag.name} 작업 메뉴`} iconOnly size="sm" variant="ghost" />
                }
              >
                <Ellipsis aria-hidden="true" size={16} />
              </Menu.Trigger>
            }
          />
          <Tooltip.Portal>
            <Tooltip.Positioner side="top" sideOffset={6}>
              <Tooltip.Popup>작업 메뉴</Tooltip.Popup>
            </Tooltip.Positioner>
          </Tooltip.Portal>
        </Tooltip.Root>
        <Menu.Portal>
          <Menu.Positioner sideOffset={6}>
            <Menu.Popup>
              <Menu.Item disabled={!runtimeAvailable || imageBusy} onClick={onCreateContainer}>
                <Play aria-hidden="true" size={14} />
                컨테이너 생성
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </>
  );
}
