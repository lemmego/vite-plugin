export async function resolvePageComponent<T>(path: string|string[], pages: Record<string, Promise<T> | (() => Promise<T>)>): Promise<T> {
    for (const pagePath of (Array.isArray(path) ? path : [path])) {
        const page = pages[pagePath]

        if (typeof page === 'undefined') continue

        return typeof page === 'function' ? page() : page
    }

    throw new Error(`Page not found: ${path}`)
}
