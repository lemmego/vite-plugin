import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import lemmego, { modulesId, pagesId } from '../src/index.js'

/* eslint-disable @typescript-eslint/no-explicit-any */

interface TestPlugin {
    name?: string
    config?: (config: any, env: any) => any
    configResolved?: (config: any) => void
    load?: (id: string) => string
}

function tempProject() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'lemmego-vite-'))
}

describe('@lemmego/vite', () => {
    it('configures the Lemmego client and SSR contracts', () => {
        const plugins = lemmego({ input: 'resources/js/app.tsx', ssr: 'resources/js/ssr.tsx' })
        const plugin = plugins.find(item => !Array.isArray(item) && item?.name === 'lemmego') as TestPlugin

        const client = plugin.config({}, { command: 'build', mode: 'production' })
        const ssr = plugin.config({ build: { ssr: true } }, { command: 'build', mode: 'production' })

        expect(client.base).toBe('/build/')
        expect(client.publicDir).toBe(false)
        expect(client.build.outDir).toBe(path.join('public', 'build'))
        expect(client.build.manifest).toBe('manifest.json')
        expect(client.build.rolldownOptions.input).toBe('resources/js/app.tsx')
        expect(ssr.build.outDir).toBe('bootstrap/ssr')
        expect(ssr.build.rolldownOptions.input).toBe('resources/js/ssr.tsx')
        expect(ssr.ssr.noExternal).toEqual(['@lemmego/vite'])
    })

    it('loads deterministic lazy page imports and sanitized module metadata', () => {
        const root = tempProject()
        fs.mkdirSync(path.join(root, '.lemmego'))
        fs.writeFileSync(path.join(root, '.lemmego/frontend.generated.json'), JSON.stringify({
            schema: 1,
            pages: { 'Z/Page': 'z.tsx', 'A/Page': 'a.tsx' },
            modules: [{ id: 'demo', framework: 'react', package: 'example/demo', root: 'vendor/demo', pages: { Demo: 'demo.tsx' } }],
        }))
        const plugins = lemmego({ input: 'app.tsx' })
        const plugin = plugins.find(item => !Array.isArray(item) && item?.name === 'lemmego:virtual') as TestPlugin
        plugin.configResolved({ root })

        const pages = plugin.load(`\0${pagesId}`)
        const modules = plugin.load(`\0${modulesId}`)
        expect(pages).toContain('"A/Page": () => import(')
        expect(pages).toContain('"Z/Page": () => import(')
        expect(modules).toContain('"id": "demo"')
        expect(modules).not.toContain('vendor/demo')
    })

    it('keeps missing frontend manifests empty', () => {
        const root = tempProject()
        const plugin = lemmego({ input: 'app.tsx' }).find(item => !Array.isArray(item) && item?.name === 'lemmego:virtual') as TestPlugin
        plugin.configResolved({ root })
        expect(plugin.load(`\0${pagesId}`)).toContain('export const pages = {')
        expect(plugin.load(`\0${modulesId}`)).toContain('export const modules = []')
    })
})
