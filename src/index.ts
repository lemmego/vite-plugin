import fs from 'node:fs'
import { AddressInfo } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import colors from 'picocolors'
import { Plugin, PluginOption, ResolvedConfig, SSROptions, UserConfig, Rolldown, defaultAllowedOrigins, loadEnv } from 'vite'
import fullReload, { Config as FullReloadConfig } from 'vite-plugin-full-reload'

export const pagesId = 'virtual:lemmego/pages'
export const modulesId = 'virtual:lemmego/modules'
export const refreshPaths = ['resources/lang/**', 'resources/views/**', 'internal/**/*.templ']

export interface RefreshConfig {
    paths: string[]
    config?: FullReloadConfig
}

export interface LemmegoPluginOptions {
    input: Rolldown.InputOption
    publicDirectory?: string
    buildDirectory?: string
    hotFile?: string
    ssr?: Rolldown.InputOption
    ssrOutputDirectory?: string
    refresh?: boolean|string|string[]|RefreshConfig|RefreshConfig[]
    transformOnServe?: (code: string, url: string) => string
    frontendManifest?: string
}

interface FrontendManifest {
    schema: number
    pages?: Record<string, string>
    modules?: Array<{
        id: string
        framework: string
        package: string
        root?: string
        pages?: Record<string, string>
        entries?: Record<string, string>
        styles?: string[]
        peerDependencies?: Record<string, string>
    }>
}

export default function lemmego(config: string|string[]|LemmegoPluginOptions): PluginOption[] {
    const pluginConfig = resolvePluginConfig(config)

    return [
        resolveVirtualPlugin(pluginConfig),
        resolveLemmegoPlugin(pluginConfig),
        ...resolveFullReloadConfig(pluginConfig),
    ]
}

function resolveVirtualPlugin(config: Required<LemmegoPluginOptions>): Plugin {
    const virtualPagesId = `\0${pagesId}`
    const virtualModulesId = `\0${modulesId}`
    let root = process.cwd()
    let manifestPath = path.resolve(root, config.frontendManifest)
    let lastManifest: FrontendManifest = { schema: 1, pages: {}, modules: [] }

    const readManifest = (): FrontendManifest => {
        if (!fs.existsSync(manifestPath)) return lastManifest

        try {
            const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as FrontendManifest
            if (parsed.schema !== 1 || typeof parsed.pages !== 'object' || !Array.isArray(parsed.modules)) {
                throw new Error('expected schema 1 with pages and modules')
            }
            lastManifest = parsed
            return parsed
        } catch (error) {
            if (error instanceof SyntaxError) {
                throw new Error(`[@lemmego/vite] Unable to parse ${manifestPath}: ${error.message}`)
            }
            throw new Error(`[@lemmego/vite] Invalid frontend manifest ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`)
        }
    }

    const pageSource = (manifest: FrontendManifest): string => Object.entries(manifest.pages ?? {})
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, source]) => `  ${JSON.stringify(name)}: () => import(${JSON.stringify(path.resolve(root, source))}),`)
        .join('\n')

    const moduleSource = (manifest: FrontendManifest): string => {
        const modules = (manifest.modules ?? []).map(({ id, framework, package: packageName, pages, entries, styles, peerDependencies }) => ({
            id,
            framework,
            package: packageName,
            pages,
            entries,
            styles,
            peerDependencies,
        }))
        return `export const modules = ${JSON.stringify(modules, null, 2)};\n`
    }

    return {
        name: 'lemmego:virtual',
        enforce: 'pre',
        config(viteConfig) {
            root = viteConfig.root ? path.resolve(viteConfig.root) : process.cwd()
            manifestPath = path.resolve(root, config.frontendManifest)
            const manifest = fs.existsSync(manifestPath) ? readManifest() : lastManifest
            const roots = (manifest.modules ?? []).map(module => module.root ? path.resolve(root, module.root) : undefined).filter((value): value is string => Boolean(value))
            return roots.length > 0 ? { server: { fs: { allow: roots } } } : {}
        },
        configResolved(resolved) {
            root = resolved.root
            manifestPath = path.resolve(root, config.frontendManifest)
        },
        resolveId(id) {
            if (id === pagesId) return virtualPagesId
            if (id === modulesId) return virtualModulesId
        },
        load(id) {
            if (id === virtualPagesId) return `export const pages = {\n${pageSource(readManifest())}\n};\n`
            if (id === virtualModulesId) return moduleSource(readManifest())
        },
        configureServer(server) {
            server.watcher.add(manifestPath)
        },
        handleHotUpdate({ file, server }) {
            if (path.resolve(file) !== manifestPath) return
            const pages = server.moduleGraph.getModuleById(virtualPagesId)
            const modules = server.moduleGraph.getModuleById(virtualModulesId)
            for (const module of [pages, modules]) {
                if (module) server.moduleGraph.invalidateModule(module)
            }
            server.ws.send({ type: 'full-reload' })
            return []
        },
    }
}

function resolveLemmegoPlugin(pluginConfig: Required<LemmegoPluginOptions>): Plugin {
    let viteDevServerUrl = ''
    let resolvedConfig: ResolvedConfig
    let userConfig: UserConfig = {}
    let hotFileOwner = false

    return {
        name: 'lemmego',
        enforce: 'post',
        config: (config, { command, mode }) => {
            userConfig = config
            const ssr = !!config.build?.ssr
            const env = loadEnv(mode, config.envDir || process.cwd(), '')
            const assetUrl = env.ASSET_URL ?? ''

            return {
                base: config.base ?? (command === 'build' ? resolveBase(pluginConfig, assetUrl) : ''),
                publicDir: config.publicDir ?? false,
                build: {
                    manifest: config.build?.manifest ?? (ssr ? false : 'manifest.json'),
                    ssrManifest: config.build?.ssrManifest ?? (ssr ? 'ssr-manifest.json' : false),
                    outDir: config.build?.outDir ?? (ssr ? pluginConfig.ssrOutputDirectory : path.join(pluginConfig.publicDirectory, pluginConfig.buildDirectory)),
                    rolldownOptions: {
                        input: config.build?.rolldownOptions?.input ?? config.build?.rollupOptions?.input ?? (ssr ? pluginConfig.ssr : pluginConfig.input),
                    },
                    assetsInlineLimit: config.build?.assetsInlineLimit ?? 0,
                },
                server: {
                    origin: config.server?.origin ?? 'http://__lemmego_vite_placeholder__.test',
                    cors: config.server?.cors ?? {
                        origin: config.server?.origin ?? [defaultAllowedOrigins, ...(env.APP_URL ? [env.APP_URL] : []), /^https?:\/\/.*\.test(:\d+)?$/],
                    },
                },
                ssr: { noExternal: noExternalLemmego(config) },
            }
        },
        configResolved(config) {
            resolvedConfig = config
        },
        transform(code) {
            if (resolvedConfig?.command === 'serve') {
                return pluginConfig.transformOnServe(code.replace(/http:\/\/__lemmego_vite_placeholder__\.test/g, viteDevServerUrl), viteDevServerUrl)
            }
        },
        configureServer(server) {
            if (process.env.VITEST !== undefined) return

            const envDir = resolvedConfig.envDir || process.cwd()
            const appUrl = loadEnv(resolvedConfig.mode, envDir, 'APP_URL').APP_URL ?? 'undefined'
            server.httpServer?.once('listening', () => {
                const address = server.httpServer?.address()
                if (!isAddressInfo(address)) return
                viteDevServerUrl = userConfig.server?.origin as string || resolveDevServerUrl(address, server.config)
                const parent = path.dirname(pluginConfig.hotFile)
                fs.mkdirSync(parent, { recursive: true })
                fs.writeFileSync(pluginConfig.hotFile, `${viteDevServerUrl}${server.config.base.replace(/\/$/, '')}`)
                hotFileOwner = true
                setTimeout(() => {
                    server.config.logger.info(`\n  ${colors.green(`${colors.bold('LEMMEGO')} ${pluginVersion()}`)}  ${colors.dim('Vite integration')}`)
                    server.config.logger.info(`  ${colors.green('➜')}  APP_URL: ${colors.cyan(appUrl)}`)
                }, 100)
            })

            const clean = () => {
                if (hotFileOwner && fs.existsSync(pluginConfig.hotFile)) fs.rmSync(pluginConfig.hotFile)
            }
            process.once('exit', clean)
            process.once('SIGINT', () => process.exit())
            process.once('SIGTERM', () => process.exit())

            return () => server.middlewares.use((req, res, next) => {
                if (req.url === '/index.html') {
                    res.statusCode = 404
                    res.end(fs.readFileSync(path.join(dirname(), 'dev-server-index.html')).toString().replace(/{{ APP_URL }}/g, appUrl))
                    return
                }
                next()
            })
        },
    }
}

function resolvePluginConfig(config: string|string[]|LemmegoPluginOptions): Required<LemmegoPluginOptions> {
    if (typeof config === 'undefined') throw new Error('[@lemmego/vite] Missing configuration.')
    if (typeof config === 'string' || Array.isArray(config)) config = { input: config }
    if (typeof config.input === 'undefined') throw new Error('[@lemmego/vite] Missing configuration for "input".')
    const publicDirectory = (config.publicDirectory ?? 'public').trim().replace(/^\/+/, '')
    const buildDirectory = (config.buildDirectory ?? 'build').trim().replace(/^\/+/, '').replace(/\/+$/, '')
    if (!publicDirectory || !buildDirectory) throw new Error('[@lemmego/vite] publicDirectory and buildDirectory must be subdirectories.')
    return {
        input: config.input,
        publicDirectory,
        buildDirectory,
        hotFile: config.hotFile ?? path.join(publicDirectory, 'hot'),
        ssr: config.ssr ?? config.input,
        ssrOutputDirectory: (config.ssrOutputDirectory ?? 'bootstrap/ssr').trim().replace(/^\/+/, '').replace(/\/+$/, ''),
        refresh: config.refresh === true ? [{ paths: refreshPaths }] : config.refresh ?? false,
        transformOnServe: config.transformOnServe ?? ((code) => code),
        frontendManifest: config.frontendManifest ?? '.lemmego/frontend.generated.json',
    }
}

function resolveBase(config: Required<LemmegoPluginOptions>, assetUrl: string): string {
    return assetUrl + (!assetUrl.endsWith('/') ? '/' : '') + config.buildDirectory + '/'
}

function resolveFullReloadConfig({ refresh }: Required<LemmegoPluginOptions>): PluginOption[] {
    if (!refresh) return []
    let configs: RefreshConfig[]
    if (typeof refresh === 'string') configs = [{ paths: [refresh] }]
    else if (Array.isArray(refresh) && refresh.some(value => typeof value === 'string')) configs = [{ paths: refresh as string[] }]
    else configs = (Array.isArray(refresh) ? refresh : [refresh]) as RefreshConfig[]
    return configs.map(config => fullReload(config.paths, config.config))
}

function resolveDevServerUrl(address: AddressInfo, config: ResolvedConfig): string {
    const hmr = typeof config.server.hmr === 'object' ? config.server.hmr : undefined
    const protocol = hmr?.protocol === 'wss' ? 'https' : config.server.https ? 'https' : 'http'
    const host = hmr?.host ?? (typeof config.server.host === 'string' ? config.server.host : isIpv6(address) ? `[${address.address}]` : address.address)
    return `${protocol}://${host}:${hmr?.clientPort ?? address.port}`
}

function noExternalLemmego(config: UserConfig): true|Array<string|RegExp> {
    const user = (config.ssr as SSROptions|undefined)?.noExternal
    if (user === true) return true
    return [...(typeof user === 'undefined' ? [] : Array.isArray(user) ? user : [user]), '@lemmego/vite']
}

function isAddressInfo(address: string|AddressInfo|null|undefined): address is AddressInfo {
    return typeof address === 'object' && address !== null
}

function isIpv6(address: AddressInfo): boolean {
    // Node 18 briefly represented address families as integers.
    return address.family === 'IPv6' || (address.family as unknown) === 6
}

function dirname(): string {
    return fileURLToPath(new URL('.', import.meta.url))
}

function pluginVersion(): string {
    try {
        return JSON.parse(fs.readFileSync(path.join(dirname(), '../package.json'), 'utf8')).version ?? ''
    } catch {
        return ''
    }
}
