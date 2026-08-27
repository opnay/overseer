import { Select } from "@opnay/city-ds-react/select";
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
  const items = Object.fromEntries(
    groups.flatMap((group) => group.items.map((item) => [item.value, item.label])),
  );

  return (
    <div className="overseer-sectioned-workspace">
      <aside
        aria-label={`${navigationLabel} 영역`}
        className="overseer-sectioned-workspace-sidebar"
      >
        <nav
          aria-label={navigationLabel}
          className="overseer-sectioned-workspace-desktop-navigation"
        >
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
        <div className="overseer-sectioned-workspace-mobile-navigation">
          <span className="overseer-sectioned-workspace-nav-label">{navigationLabel}</span>
          <Select.Root
            items={items}
            onValueChange={(value) => value && onSectionChange(String(value) as Section)}
            value={section}
          >
            <Select.Trigger aria-label={navigationLabel}>
              <Select.Value />
              <Select.Icon />
            </Select.Trigger>
            <Select.Portal>
              <Select.Positioner>
                <Select.Popup>
                  <Select.List>
                    {groups.map((group) => (
                      <Select.Group key={group.label}>
                        <Select.GroupLabel>{group.label}</Select.GroupLabel>
                        {group.items.map((item) => (
                          <Select.Item key={item.value} value={item.value}>
                            <Select.ItemIndicator />
                            <Select.ItemText>{item.label}</Select.ItemText>
                          </Select.Item>
                        ))}
                      </Select.Group>
                    ))}
                  </Select.List>
                </Select.Popup>
              </Select.Positioner>
            </Select.Portal>
          </Select.Root>
        </div>
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
