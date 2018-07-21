'use strict'

const fs = require('fs')
const path = require('path')
const sorter = require('path-sort').standalone(path.delimiter)

function getFileList (dirPath) {
  dirPath = path.resolve(dirPath)
  const items = getItems(dirPath, 0).sort(sorter)
  return toHtml(dirPath, items)
}

function getItems (parent) {
  let items = []
  try {
    // Iterate over list of children.
    for (let child of fs.readdirSync(parent)) {
      const fullPath = path.join(parent, child)

      if (fs.statSync(fullPath).isDirectory()) {
        // Add the children.
        items = items.concat(getItems(fullPath))
        // Add all HTML files.
      } else if (path.extname(child) === '.html') {
        items.push(fullPath)
      }
    }
  } catch (err) {
    console.error(err)
  }

  return items
}

function toHtml (dirPath, items) {
  const html = items.map(item => {
    const short = item.substr(dirPath.length + 1)
    const depth = (short.match(/\\|\//g) || []).length
    const href = `/${short.replace(/\\/g, '/')}`
    return `<a href="${href}" class="depth--${depth}">${short}</a><br/>`
  })

  return html.join('\n')
}

module.exports = getFileList
