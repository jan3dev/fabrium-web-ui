// vite-plugin-svgr turns `*.svg?react` imports into React components.
declare module "*.svg?react" {
  import type { FC, SVGProps } from "react";

  /** `title` exists because the plugin runs with `titleProp: true`. */
  const ReactComponent: FC<SVGProps<SVGSVGElement> & { title?: string }>;
  export default ReactComponent;
}
