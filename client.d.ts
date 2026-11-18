declare module "virtual:lemmego/pages" {
  export type PageLoader<T = any> = () => Promise<T>;
  export const pages: Record<string, PageLoader>;
}

declare module "virtual:lemmego/modules" {
  export interface LemmegoFrontendModule {
    id: string;
    framework: "react" | "vue" | string;
    package: string;
    pages?: Record<string, string>;
    entries?: Record<string, string>;
    styles?: string[];
    peerDependencies?: Record<string, string>;
  }
  export const modules: LemmegoFrontendModule[];
}
