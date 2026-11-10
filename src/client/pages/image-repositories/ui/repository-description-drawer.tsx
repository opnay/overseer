import { Button } from "@opnay/city-ds-react/button";
import { Drawer } from "@opnay/city-ds-react/drawer";
import { DataTableRegion } from "@opnay/city-ds-react/data-table-region";
import { ExternalLink, X } from "lucide-react";
import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";

function documentUrl(value: string | undefined, repository: string): string | undefined {
  if (!value) return undefined;
  try {
    // Docker Hub is currently the source of full_description. Resolve README-relative
    // resources against its public page rather than the app's internal URL.
    const name = repository.replace(/^docker\.io\//, "");
    const base = name.startsWith("library/")
      ? `https://hub.docker.com/_/${name.slice(8)}`
      : `https://hub.docker.com/r/${name}`;
    const url = new URL(value, `${base}/`);
    return ["http:", "https:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function RepositoryDescriptionDrawer({
  repository,
  description,
  open,
  onOpenChange,
}: {
  repository: string;
  description: string;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
  }, []);

  return (
    <Drawer.Root modal open={ready && open} onOpenChange={onOpenChange} swipeDirection="right">
      <Drawer.Portal>
        <Drawer.Backdrop className="overseer-repository-description-motion" />
        <Drawer.Viewport side="right">
          <Drawer.Popup className="overseer-repository-description-motion" side="right" size="xl">
            <Drawer.Header>
              <div>
                <Drawer.Title>{repository} 상세 설명</Drawer.Title>
                <Drawer.Description>레지스트리에서 제공한 이미지 설명입니다.</Drawer.Description>
              </div>
              <Drawer.Close
                render={<Button aria-label="상세 설명 닫기" iconOnly size="sm" variant="ghost" />}
              >
                <X aria-hidden="true" size={16} />
              </Drawer.Close>
            </Drawer.Header>
            <Drawer.Content>
              <div className="overseer-repository-readme">
                <Markdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeRaw, rehypeSanitize]}
                  components={{
                    a: ({ href, children, title }) => {
                      const destination = documentUrl(href, repository);
                      return destination ? (
                        <a href={destination} title={title} target="_blank" rel="noreferrer">
                          {children}
                          <ExternalLink aria-hidden="true" size={13} />
                        </a>
                      ) : (
                        <span>{children}</span>
                      );
                    },
                    img: ({ src, alt, title, width, height }) => (
                      <img
                        src={typeof src === "string" ? documentUrl(src, repository) : undefined}
                        alt={alt ?? ""}
                        title={title}
                        width={width}
                        height={height}
                        loading="lazy"
                        decoding="async"
                        referrerPolicy="no-referrer"
                      />
                    ),
                    table: ({ children }) => (
                      <DataTableRegion label="상세 설명 표">
                        <table>{children}</table>
                      </DataTableRegion>
                    ),
                  }}
                >
                  {description}
                </Markdown>
              </div>
            </Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
