import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = fileURLToPath(new URL('../', import.meta.url))
const paths = ['packages/engine-sdk', 'games/remorse', 'games/overdrive', 'apps/server']
const packages = await Promise.all(paths.map(async path => ({
  path, directory: resolve(root, path), manifest: JSON.parse(await readFile(join(root, path, 'package.json'), 'utf8')),
})))
const byName = new Map(packages.map(pkg => [pkg.manifest.name, pkg]))
const failures = []
let checked = 0

async function sources(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await sources(path))
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) files.push(path)
  }
  return files
}

for (const pkg of packages) {
  for (const file of await sources(join(pkg.directory, 'src'))) {
    checked++
    const tree = ts.createSourceFile(file, await readFile(file, 'utf8'), ts.ScriptTarget.Latest, true)
    const sourceIsCore = file.startsWith(join(pkg.directory, 'src', 'core') + sep)
    const check = specifier => {
      if (specifier.startsWith('.')) {
        const target = resolve(dirname(file), specifier)
        if (!target.startsWith(pkg.directory + sep)) failures.push(`${relative(root, file)}: relative import crosses package boundary: ${specifier}`)
        if (sourceIsCore && !target.startsWith(join(pkg.directory, 'src', 'core') + sep) && target !== join(pkg.directory, 'src', 'core')) {
          failures.push(`${relative(root, file)}: rules core imports outside its core: ${specifier}`)
        }
        return
      }
      if (pkg.manifest.name === '@chess-2/engine-sdk' || sourceIsCore) {
        failures.push(`${relative(root, file)}: pure rules/search imports an external dependency: ${specifier}`)
      }
      if (!specifier.startsWith('@chess-2/')) return
      const name = specifier.split('/').slice(0, 2).join('/')
      const dependency = byName.get(name)
      const exportPath = specifier === name ? '.' : '.' + specifier.slice(name.length)
      if (!dependency || !pkg.manifest.dependencies?.[name] || !dependency.manifest.exports?.[exportPath]) {
        failures.push(`${relative(root, file)}: undeclared workspace dependency/export: ${specifier}`)
      }
      if (pkg.path.startsWith('games/') && name !== '@chess-2/engine-sdk') {
        failures.push(`${relative(root, file)}: a game depends on another game or server: ${specifier}`)
      }
    }
    const visit = node => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) check(node.moduleSpecifier.text)
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) check(node.arguments[0].text)
      ts.forEachChild(node, visit)
    }
    visit(tree)
  }
}
if (failures.length) {
  process.stderr.write(failures.join('\n') + '\n')
  process.exitCode = 1
} else process.stdout.write(`Package boundaries valid across ${checked} source files; rules/search remain pure.\n`)
