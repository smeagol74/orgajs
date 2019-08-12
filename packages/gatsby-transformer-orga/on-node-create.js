const { Parser } = require('orga')
const crypto = require('crypto')
const path = require('path')
const util = require('util')
const { selectAll, select } = require('unist-util-select')
const {
  getProperties,
  sanitise,
  processMeta,
  getAST,
  cacheAST,
} = require('./orga-util')

const getCircularReplacer = () => {
  const seen = new WeakSet()
  return (key, value) => {
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) {
        return
      }
      seen.add(value)
    }
    return value
  }
}

module.exports = async function onCreateNode(
  { node, loadNodeContent, actions, cache, pathPrefix }) {

  const { createNode, createParentChildLink, createNodeField } = actions
  // We only care about org content. The mime is not useful for us. Use extension directly
  if (node.extension === `org`) {
    await createOrgFileNode(node)
  }

  if (node.internal.type === `OrgFile`) {
    await createOrgContentNodes(node)
  }

  async function createOrgFileNode(fileNode) {
    const content = await loadNodeContent(fileNode)

    const contentDigest = crypto
          .createHash(`md5`)
          .update(content)
          .digest(`hex`)
    const orgFileNode = {
      id: `${fileNode.id} >>> OrgFile`,
      children: [],
      parent: fileNode.id,
      // ast: await getAST(content),
      internal: {
        content,
        contentDigest,
        type: `OrgFile`,
      },
    }

    // Add path to the org-mode file path
    if (fileNode.internal.type === `File`) {
      orgFileNode.fileAbsolutePath = fileNode.absolutePath
      orgFileNode.fileName = fileNode.name
    }

    createNode(orgFileNode)
    createParentChildLink({ parent: fileNode, child: orgFileNode })
  }

  async function createOrgContentNodes(orgFileNode) {
    // const ast = orgFileNode.ast
    const ast = await getAST({ node: orgFileNode, cache })
    // console.log(`>>> ${util.inspect(orgFileNode, false, null, true)}`)
    const { orga_publish_keyword } = ast.meta
    let content
    if (orga_publish_keyword) { // section
      content = selectAll(`[keyword=${orga_publish_keyword}]`, ast)
        .map(ast => {
          const title = select(`text`, ast).value
          let meta = {
            title,
            export_file_name: sanitise(title),
            category: orgFileNode.fileName,
            tags: ast.tags,
            ...getProperties(ast),
          }
          meta.date = meta.date ||
            meta.export_date ||
            (select(`planning`, ast) || {}).timestamp
          const absolutePath = `${orgFileNode.fileAbsolutePath}::*${title}`
          return {
            meta,
            getAST: () => ast.parent, // we need the secion of the headline
            absolutePath,
          }
        })
    } else { // root
        let meta = {
          export_file_name: orgFileNode.fileName,
          ...ast.meta }
      meta.title = meta.title || 'Untitled'
      const absolutePath = `${orgFileNode.fileAbsolutePath}`
      content = [ {
        meta,
        getAST: () => ast,
        absolutePath,
      } ]
    }

    content.forEach((node, index) => {
      const id = `${orgFileNode.id} >>> OrgContent[${index}]`
      const ast = node.getAST()
      const contentDigest =
            crypto.createHash(`md5`)
                  .update(JSON.stringify(ast, getCircularReplacer()))
                  .digest(`hex`)
      const n = {
        id,
        orga_id: id,
        children: [],
        parent: orgFileNode.id,
        internal: {
          contentDigest,
          type: `OrgContent`,
        },
        ...node,
        meta: processMeta(node.meta),
      }
      cacheAST({ ast, node: n, cache })

      // creating slug
      const { category, export_file_name } = n.meta
      const paths = [
        `/`,
        category,
        export_file_name,
      ].filter(lpath => lpath)
      const slug = path.posix.join(...paths)
      createNode(n)
      createNodeField({
        node: n,
        name: `slug`,
        value: slug,
      })
      createParentChildLink({ parent: orgFileNode, child: n })
    })
  }
}