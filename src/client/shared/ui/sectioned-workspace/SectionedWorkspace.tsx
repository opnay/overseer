import { useId, type ReactNode } from "react";

export interface SectionedWorkspaceGroup<Section extends string> {
  items: ReadonlyArray<{ label: string; value: Section }>;
  label: string;
}

export function SectionedWorkspace<Section extends string>({
  category,
  children,
  description,
  groups,
  navigationLabel,
  onSectionChange,
  section,
  title,
}: {
  category: string;
  children: ReactNode;
  description: string;
  groups: ReadonlyArray<SectionedWorkspaceGroup<Section>>;
  navigationLabel: string;
  onSectionChange(section: Section): void;
  section: Section;
  title: string;
}) {
  const navigationId = useId();

  return (
    <div className="overseer-sectioned-workspace">
      <aside className="overseer-sectioned-workspace-sidebar">
        <nav aria-label={navigationLabel}>
          {groups.map((group, groupIndex) => {
            const labelId = `${navigationId}-${groupIndex}`;
            return (
              <div
                aria-labelledby={labelId}
                className="overseer-sectioned-workspace-nav-group"
                key={group.label}
                role="group"
              >
                <span className="overseer-sectioned-workspace-nav-label" id={labelId}>
                  {group.label}
                </span>
                <div className="overseer-sectioned-workspace-nav-items">
                  {group.items.map((item) => (
                    <button
                      aria-current={section === item.value ? "page" : undefined}
                      key={item.value}
                      onClick={() => onSectionChange(item.value)}
                      type="button"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>
      </aside>

      <div className="overseer-sectioned-workspace-content">
        <header className="overseer-sectioned-workspace-header">
          <p>{category}</p>
          <h2 className="city-text-section-title">{title}</h2>
          <span className="city-text-supporting">{description}</span>
        </header>
        <div className="overseer-sectioned-workspace-body">{children}</div>
      </div>
    </div>
  );
}
