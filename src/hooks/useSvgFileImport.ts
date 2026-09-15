import { useCallback } from "react";
import { useDesignStore } from "../store/designStore";

/** Shared helper for importing one or more dropped/selected SVG files, used by both the
 *  toolbar's file picker and the whole-app drag-and-drop zone. */
export function useSvgFileImport() {
  const importSvgFile = useDesignStore((s) => s.importSvgFile);

  return useCallback(
    async (files: FileList | File[] | null | undefined) => {
      if (!files) return;
      const list = Array.from(files);
      const svgFiles = list.filter((f) => /\.svg$/i.test(f.name) || f.type === "image/svg+xml");

      if (svgFiles.length === 0 && list.length > 0) {
        alert("Only .svg files can be imported.");
        return;
      }

      for (const file of svgFiles) {
        try {
          await importSvgFile(file);
        } catch (err: any) {
          alert(`Could not import ${file.name}: ${err?.message ?? err}`);
        }
      }
    },
    [importSvgFile]
  );
}
