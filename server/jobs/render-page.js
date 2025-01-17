const _ = require('lodash')
const cheerio = require('cheerio')

/* global WIKI */

module.exports = async (pageId) => {
  WIKI.logger.info(`Rendering page ID ${pageId}...`)

  try {
    WIKI.models = require('../core/db').init()
    await WIKI.configSvc.loadFromDb()
    await WIKI.configSvc.applyFlags()

    const page = await WIKI.models.pages.getPageFromDb(pageId)
    if (!page) {
      throw new Error('Invalid Page Id')
    }
    await WIKI.models.renderers.fetchDefinitions()
    const pipeline = await WIKI.models.renderers.getRenderingPipeline(page.contentType)
    // STUDENT EMENE FLAG: START
    let output = page.content
    // console.log(output)
    // console.log('content type', page.contentType)
    // if (page.contentType === 'markdown') {
    //   let match
    //   const regexPattern = /{include: (\d+)}/g
    //   // console.log('page content is ', typeof page.content)
    //   while ((match = regexPattern.exec(output)) !== null) {
    //     const id = match[1]
    //     // console.log(typeof id)
    //     const page2 = await WIKI.models.pages.getPageFromDb(parseInt(id))
    //     if (!page2) {
    //       throw new Error('Include page does not exist')
    //     }
    //     if (page2.id === page.id) {
    //       output = output.replace(match[0], '')
    //     }
    //     output = output.replace(match[0], page2.content)
    //   }
    //   // puts the ID at the bottom of the page
    //   output = output + `\n <br><br><br><br><br><br><br><br><br><br><br> <span style="opacity: 0.3;">id: ${pageId}</span>`
    // }

    // console.log('output is', output)
    // STUDENT EMENE FLAG: END
    if (_.isEmpty(page.content)) {
      await WIKI.models.knex.destroy()
      WIKI.logger.warn(`Failed to render page ID ${pageId} because content was empty: [ FAILED ]`)
    }

    for (let core of pipeline) {
      const renderer = require(`../modules/rendering/${_.kebabCase(core.key)}/renderer.js`)
      output = await renderer.render.call({
        config: core.config,
        children: core.children,
        page: page,
        input: output
      })
    }

    // Parse TOC
    const $ = cheerio.load(output)
    let isStrict = $('h1').length > 0 // <- Allows for documents using H2 as top level
    let toc = { root: [] }

    $('h1,h2,h3,h4,h5,h6').each((idx, el) => {
      const depth = _.toSafeInteger(el.name.substring(1)) - (isStrict ? 1 : 2)
      let leafPathError = false

      const leafPath = _.reduce(_.times(depth), (curPath, curIdx) => {
        if (_.has(toc, curPath)) {
          const lastLeafIdx = _.get(toc, curPath).length - 1
          if (lastLeafIdx >= 0) {
            curPath = `${curPath}[${lastLeafIdx}].children`
          } else {
            leafPathError = true
          }
        }
        return curPath
      }, 'root')

      if (leafPathError) { return }

      const leafSlug = $('.toc-anchor', el).first().attr('href')
      $('.toc-anchor', el).remove()

      _.get(toc, leafPath).push({
        title: _.trim($(el).text()),
        anchor: leafSlug,
        children: []
      })
    })

    // Save to DB
    await WIKI.models.pages.query()
      .patch({
        render: output,
        toc: JSON.stringify(toc.root)
      })
      .where('id', pageId)

    // Save to cache
    await WIKI.models.pages.savePageToCache({
      ...page,
      render: output,
      toc: JSON.stringify(toc.root)
    })

    await WIKI.models.knex.destroy()

    WIKI.logger.info(`Rendering page ID ${pageId}: [ COMPLETED ]`)
  } catch (err) {
    WIKI.logger.error(`Rendering page ID ${pageId}: [ FAILED ]`)
    WIKI.logger.error(err.message)
    // exit process with error code
    throw err
  }
}
