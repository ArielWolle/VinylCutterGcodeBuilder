import { useDesignStore } from "../store/designStore";

export function LayersPanel() {
  const items = useDesignStore((s) => s.items);
  const selectedId = useDesignStore((s) => s.selectedId);
  const selectItem = useDesignStore((s) => s.selectItem);
  const setItemVisible = useDesignStore((s) => s.setItemVisible);
  const setItemLocked = useDesignStore((s) => s.setItemLocked);
  const removeItem = useDesignStore((s) => s.removeItem);
  const reorderItem = useDesignStore((s) => s.reorderItem);
  const renameItem = useDesignStore((s) => s.renameItem);

  return (
    <div className="panel">
      <h3>Imported SVGs</h3>
      {items.length === 0 && <p className="muted">No SVGs imported yet.</p>}
      <ul className="layer-list">
        {items
          .slice()
          .reverse()
          .map((item) => (
            <li key={item.id} className={item.id === selectedId ? "layer-item selected" : "layer-item"} onClick={() => selectItem(item.id)}>
              <button
                className="icon-toggle"
                title={item.visible ? "Hide" : "Show"}
                onClick={(e) => {
                  e.stopPropagation();
                  setItemVisible(item.id, !item.visible);
                }}
              >
                {item.visible ? "\u{1F441}" : "\u{1F648}"}
              </button>
              <input
                className="layer-name"
                value={item.name}
                onChange={(e) => renameItem(item.id, e.target.value)}
                onClick={(e) => e.stopPropagation()}
              />
              <button
                className="icon-toggle"
                title={item.locked ? "Unlock" : "Lock"}
                onClick={(e) => {
                  e.stopPropagation();
                  setItemLocked(item.id, !item.locked);
                }}
              >
                {item.locked ? "\u{1F512}" : "\u{1F513}"}
              </button>
              <button
                className="icon-toggle"
                title="Move up"
                onClick={(e) => {
                  e.stopPropagation();
                  reorderItem(item.id, "up");
                }}
              >
                {"\u2191"}
              </button>
              <button
                className="icon-toggle"
                title="Move down"
                onClick={(e) => {
                  e.stopPropagation();
                  reorderItem(item.id, "down");
                }}
              >
                {"\u2193"}
              </button>
              <button
                className="icon-toggle danger"
                title="Delete"
                onClick={(e) => {
                  e.stopPropagation();
                  removeItem(item.id);
                }}
              >
                {"\u2715"}
              </button>
            </li>
          ))}
      </ul>
      <p className="muted small">Cut order follows this list top-to-bottom (last item cut last is at the top here).</p>
    </div>
  );
}
